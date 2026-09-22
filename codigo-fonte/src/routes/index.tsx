import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  playClick,
  playSuccess,
  playPomodoroEnd,
  playReminder,
  startAlarm,
  primeAudio,
  type AlarmHandle,
} from "../lib/sound";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Rotina DR — Sistema de Alta Performance" },
      { name: "description", content: "Dashboard de rotina diária com pomodoro, lembretes, kanban e metas." },
      { property: "og:title", content: "Rotina DR" },
      { property: "og:description", content: "Dashboard de rotina diária com pomodoro, lembretes, kanban e metas." },
    ],
  }),
  component: Index,
});

/* ---------- helpers ---------- */

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function weekKey() {
  const d = new Date();
  const day = d.getDay(); // 0=Sun .. 1=Mon
  const diff = (day === 0 ? -6 : 1 - day);
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return `${monday.getFullYear()}-${monday.getMonth() + 1}-${monday.getDate()}`;
}

/* local storage with cross-component sync */

const LOCAL_SYNC_EVENT = "__local_sync__";

function readLS<T>(key: string, initial: T): T {
  if (typeof window === "undefined") return initial;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : initial;
  } catch {
    return initial;
  }
}

function writeLS<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function useLocal<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => readLS(key, initial));

  useEffect(() => {
    const onSync = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.key === key) {
        setV(detail.value);
      }
    };
    window.addEventListener(LOCAL_SYNC_EVENT, onSync);
    return () => window.removeEventListener(LOCAL_SYNC_EVENT, onSync);
  }, [key]);

  const setWrapped = useCallback(
    (next: T | ((p: T) => T)) => {
      setV((prev) => {
        const value = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        writeLS(key, value);
        // Defer event dispatch to avoid setting state during render
        queueMicrotask(() => {
          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent(LOCAL_SYNC_EVENT, { detail: { key, value } })
            );
          }
        });
        return value;
      });
    },
    [key]
  );

  return [v, setWrapped];
}

const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

/* ---------- types ---------- */

type Task = { id: string; text: string; done: boolean };
type BlocksState = { tasks: Record<number, Task[]>; lastDay: string };
type Compromisso = { id: string; text: string; time: string | null; done: boolean; firedDay?: string };
type DailyList<T> = { items: T[]; day: string };
type WeeklyList<T> = { items: T[]; week: string };
type KanbanCard = { id: string; text: string };
type KanbanState = { todo: KanbanCard[]; doing: KanbanCard[]; done: KanbanCard[] };
type MetricsHistory = Record<string, { done: number; total: number }>;

const BLOCKS = [
  { id: 1, title: "Bloco 1 - Preparação", color: "var(--color-primary)" },
  { id: 2, title: "Bloco 2 - Execução", color: "oklch(0.7 0.2 320)" },
  { id: 3, title: "Bloco 3 - Produção", color: "oklch(0.78 0.2 145)" },
  { id: 4, title: "Bloco 4 - Revisão", color: "oklch(0.7 0.2 320)" },
];

/* ---------- root ---------- */

function Index() {
  useEffect(() => {
    const h = () => primeAudio();
    window.addEventListener("click", h, { once: true });
    return () => window.removeEventListener("click", h);
  }, []);

  const dateLabel = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  // global day/week tick
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
        <Header dateLabel={dateLabel} />
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          <CompromissosCard />
          <AnotacoesCard />
        </div>
        <div className="mt-5 grid gap-5 md:grid-cols-[1fr_320px]">
          <PomodoroCard />
          <SaudeCard />
        </div>
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <SemanaCard storageKey="aprendizados-semana-v1" title="Aprendizados da Semana" />
          <SemanaCard storageKey="metas-semana-v1" title="Metas da Semana" />
        </div>
        <div className="mt-5">
          <KanbanBoard />
        </div>
        <div className="mt-5">
          <BlocosRotina />
        </div>
        <div className="mt-5">
          <MetricasMes />
        </div>
        <footer className="mt-10 text-center text-xs text-muted-foreground">
          Tudo é salvo no seu navegador. Resets diários ocorrem à meia-noite, semanais na segunda.
        </footer>
      </div>
    </div>
  );
}

/* ---------- header ---------- */

function Header({ dateLabel }: { dateLabel: string }) {
  const [s] = useLocal<BlocksState>("rotina-diaria-v1", { tasks: { 1: [], 2: [], 3: [], 4: [] }, lastDay: todayKey() });
  const all = Object.values(s.tasks).flat();
  const done = all.filter((t) => t.done).length;
  const pct = all.length ? Math.round((done / all.length) * 100) : 0;

  return (
    <header className="text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-primary">Sistema de Alta Performance</p>
      <h1 className="mt-2 text-4xl font-extrabold tracking-tight sm:text-5xl">
        <span className="bg-gradient-to-r from-primary via-foreground to-fuchsia-400 bg-clip-text text-transparent">ROTINA DR</span>
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">Dashboard pessoal de rotina e alta performance</p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-sm">
        <span className="rounded-full border border-border bg-card px-3 py-1.5 capitalize">📅 {dateLabel}</span>
        <span className="rounded-full border border-border bg-card px-3 py-1.5">🎯 {done}/{all.length} tarefas</span>
        <span className="rounded-full border border-border bg-card px-3 py-1.5 text-emerald-400">📈 {pct}%</span>
      </div>
      <div className="mx-auto mt-4 h-1.5 max-w-md overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-gradient-to-r from-primary to-fuchsia-400 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </header>
  );
}

/* ---------- card shell ---------- */

function Card({ title, action, children, accent }: { title: string; action?: React.ReactNode; children: React.ReactNode; accent?: string }) {
  return (
    <section
      className="rounded-xl border border-border bg-card p-5 shadow-sm"
      style={accent ? { borderColor: accent } : undefined}
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold" style={accent ? { color: accent } : undefined}>{title}</h2>
        <div className="flex items-center gap-2">{action}</div>
      </div>
      {children}
    </section>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
      {label}
      <div className="mt-1 text-xs opacity-70">Clique em + para adicionar</div>
    </div>
  );
}

/* ---------- compromissos ---------- */

function CompromissosCard() {
  const [state, setState] = useLocal<DailyList<Compromisso>>("compromissos-v1", { items: [], day: todayKey() });
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [time, setTime] = useState("");
  const [alarmPlaying, setAlarmPlaying] = useState(false);
  const alarmRef = useRef<{ id: string; handle: AlarmHandle } | null>(null);

  // daily reset
  useEffect(() => {
    if (state.day !== todayKey()) setState({ items: [], day: todayKey() });
  }, [state.day, setState]);

  // check alarms each minute
  useEffect(() => {
    const check = () => {
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const today = todayKey();
      for (const c of state.items) {
        if (c.done || !c.time || c.firedDay === today) continue;
        if (c.time <= hhmm) {
          // trigger
          setState((s) => ({ ...s, items: s.items.map((x) => x.id === c.id ? { ...x, firedDay: today } : x) }));
          if (!alarmRef.current) {
            const h = startAlarm();
            alarmRef.current = { id: c.id, handle: h };
            setAlarmPlaying(true);
            toast.warning(`⏰ Compromisso: ${c.text}`, {
              duration: Infinity,
              action: {
                label: "Parar",
                onClick: () => stopAlarm(),
              },
            });
          }
        }
      }
    };
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [state.items, setState]);

  function stopAlarm() {
    if (alarmRef.current) {
      alarmRef.current.handle.stop();
      alarmRef.current = null;
      setAlarmPlaying(false);
    }
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setState((s) => ({ ...s, items: [...s.items, { id: uid(), text: t, time: time || null, done: false }] }));
    setText("");
    setTime("");
    setAdding(false);
    playClick();
    toast.success("Compromisso adicionado");
  }

  function toggle(id: string) {
    setState((s) => ({ ...s, items: s.items.map((c) => c.id === id ? { ...c, done: !c.done } : c) }));
    if (alarmRef.current?.id === id) stopAlarm();
    playSuccess();
    toast.success("Compromisso atualizado");
  }
  function del(id: string) {
    if (!confirm("Deletar compromisso?")) return;
    if (alarmRef.current?.id === id) stopAlarm();
    setState((s) => ({ ...s, items: s.items.filter((c) => c.id !== id) }));
    toast("Compromisso removido");
  }

  return (
    <Card
      title="Compromissos do Dia"
      action={
        <button onClick={() => setAdding((v) => !v)} className="rounded-md p-1 text-muted-foreground hover:text-primary" aria-label="Adicionar">
          +
        </button>
      }
    >
      {alarmPlaying && (
        <div className="mb-3 flex items-center justify-between rounded-md border border-red-400/50 bg-red-500/10 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-red-400">
            <span>🔔</span>
            <span>Alarme tocando!</span>
          </div>
          <button
            onClick={() => stopAlarm()}
            className="rounded-md bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600"
          >
            Desligar Alarme
          </button>
        </div>
      )}
      {adding && (
        <form onSubmit={add} className="mb-3 flex flex-col gap-2 rounded-md border border-border bg-secondary/40 p-3">
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Descrição do compromisso" className="rounded-md border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary" />
          <div className="flex gap-2">
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="rounded-md border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary" />
            <button type="submit" className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Adicionar</button>
          </div>
        </form>
      )}
      {state.items.length === 0 && !adding && <EmptyState label="Nenhum compromisso" />}
      <ul className="flex flex-col gap-2">
        {state.items.map((c) => (
          <li key={c.id} className="group flex items-center gap-3 rounded-md border border-border bg-secondary/40 px-3 py-2">
            <input type="checkbox" checked={c.done} onChange={() => toggle(c.id)} className="h-4 w-4 accent-[var(--color-primary)]" />
            <div className="flex-1">
              <div className={`text-sm ${c.done ? "text-muted-foreground line-through" : ""}`}>{c.text}</div>
              {c.time && <div className="text-xs text-primary">⏰ {c.time}</div>}
            </div>
            <button onClick={() => del(c.id)} className="rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100">×</button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ---------- anotações ---------- */

function AnotacoesCard() {
  const [state, setState] = useLocal<DailyList<{ id: string; text: string }>>("anotacoes-v1", { items: [], day: todayKey() });
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");

  useEffect(() => {
    if (state.day !== todayKey()) setState({ items: [], day: todayKey() });
  }, [state.day, setState]);

  function add(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setState((s) => ({ ...s, items: [...s.items, { id: uid(), text: t }] }));
    setText("");
    setAdding(false);
    playClick();
    toast.success("Anotação salva");
  }
  function del(id: string) {
    if (!confirm("Deletar anotação?")) return;
    setState((s) => ({ ...s, items: s.items.filter((x) => x.id !== id) }));
    toast("Anotação removida");
  }

  return (
    <Card
      title="Anotações do Dia"
      action={
        <button onClick={() => setAdding((v) => !v)} className="rounded-md p-1 text-muted-foreground hover:text-primary" aria-label="Adicionar">+</button>
      }
    >
      {adding && (
        <form onSubmit={add} className="mb-3 flex gap-2">
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Escreva uma anotação..." className="flex-1 rounded-md border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary" />
          <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">+</button>
        </form>
      )}
      {state.items.length === 0 && !adding && <EmptyState label="Nenhuma anotação" />}
      <ul className="flex flex-col gap-2">
        {state.items.map((a) => (
          <li key={a.id} className="group flex items-start gap-3 rounded-md border border-border bg-secondary/40 px-3 py-2">
            <span className="flex-1 whitespace-pre-wrap text-sm">{a.text}</span>
            <button onClick={() => del(a.id)} className="rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100">×</button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ---------- pomodoro ---------- */

type PomodoroMode = "foco" | "curta" | "longa";
type PomodoroSettings = { foco: number; curta: number; longa: number };

function PomodoroCard() {
  const [settings, setSettings] = useLocal<PomodoroSettings>("pomodoro-settings-v1", { foco: 25, curta: 5, longa: 15 });
  const [sessions, setSessions] = useLocal<number>("pomodoro-sessions-v1", 0);
  const [mode, setMode] = useState<PomodoroMode>("foco");
  const [seconds, setSeconds] = useState(settings.foco * 60);
  const [running, setRunning] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    if (!running) setSeconds(settings[mode] * 60);
  }, [mode, settings, running]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          clearInterval(id);
          setRunning(false);
          playPomodoroEnd();
          if (mode === "foco") {
            setSessions((n) => n + 1);
            toast.success("🍅 Foco concluído! Hora de uma pausa.");
          } else {
            toast.success("✅ Pausa terminada!");
          }
          return settings[mode] * 60;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, mode, settings, setSessions]);

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  const labels: Record<PomodoroMode, { name: string; color: string }> = {
    foco: { name: "Foco", color: "var(--color-primary)" },
    curta: { name: "Pausa Curta", color: "oklch(0.7 0.2 320)" },
    longa: { name: "Pausa Longa", color: "oklch(0.78 0.2 145)" },
  };

  return (
    <Card title="Pomodoro" action={
      <button onClick={() => setShowSettings((v) => !v)} className="rounded-md p-1 text-muted-foreground hover:text-primary" aria-label="Configurações">⚙</button>
    }>
      <div className="mb-4 inline-flex rounded-md border border-border bg-secondary/40 p-1 text-sm">
        {(["foco", "curta", "longa"] as PomodoroMode[]).map((m) => (
          <button key={m} onClick={() => { setMode(m); setRunning(false); playClick(); }} className={`rounded px-3 py-1 capitalize ${mode === m ? "bg-card text-foreground" : "text-muted-foreground"}`}>
            {m === "foco" ? "Foco" : m === "curta" ? "Curta" : "Longa"}
          </button>
        ))}
      </div>

      {showSettings && (
        <div className="mb-4 grid grid-cols-3 gap-2 rounded-md border border-border bg-secondary/40 p-3 text-sm">
          {(["foco", "curta", "longa"] as PomodoroMode[]).map((m) => (
            <label key={m} className="flex flex-col gap-1">
              <span className="text-xs capitalize text-muted-foreground">{m} (min)</span>
              <input type="number" min={1} max={120} value={settings[m]} onChange={(e) => setSettings({ ...settings, [m]: Math.max(1, Number(e.target.value)) })} className="rounded-md border border-border bg-input px-2 py-1 text-sm outline-none focus:border-primary" />
            </label>
          ))}
        </div>
      )}

      <div className="flex flex-col items-center gap-4 py-4">
        <div className="flex h-44 w-44 items-center justify-center rounded-full border-2 border-border">
          <div className="text-center">
            <div className="text-4xl font-bold tracking-widest">{mm}:{ss}</div>
            <div className="mt-1 text-sm" style={{ color: labels[mode].color }}>{labels[mode].name}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setRunning((r) => !r); playClick(); }} className="rounded-md bg-primary px-6 py-2 font-semibold text-primary-foreground">
            {running ? "⏸ Pausar" : "▶ Iniciar"}
          </button>
          <button onClick={() => { setRunning(false); setSeconds(settings[mode] * 60); playClick(); }} className="rounded-md border border-border bg-card px-3 py-2" aria-label="Resetar">↻</button>
        </div>
        <div className="text-xs text-muted-foreground">Sessões concluídas: {sessions}</div>
      </div>
    </Card>
  );
}

/* ---------- saúde ---------- */

type SaudeItem = { id: "agua" | "respirar" | "postura" | "olhos"; label: string; emoji: string; minutes: number; color: string };
const SAUDE_DEFAULTS: SaudeItem[] = [
  { id: "agua", label: "Água", emoji: "💧", minutes: 30, color: "var(--color-primary)" },
  { id: "respirar", label: "Respirar", emoji: "🌬", minutes: 45, color: "oklch(0.78 0.2 145)" },
  { id: "postura", label: "Postura", emoji: "🧍", minutes: 25, color: "oklch(0.7 0.2 320)" },
  { id: "olhos", label: "Olhos", emoji: "👁", minutes: 20, color: "oklch(0.85 0.15 80)" },
];

function SaudeCard() {
  const [items, setItems] = useLocal<SaudeItem[]>("saude-itens-v1", SAUDE_DEFAULTS);
  const [active, setActive] = useLocal<boolean>("saude-active-v1", false);
  const [last, setLast] = useLocal<Record<string, number>>("saude-last-v1", {});
  const [now, setNow] = useState(() => Date.now());

  // tick
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // initialize last timestamps lazily
  useEffect(() => {
    const missing = items.filter((it) => !last[it.id]);
    if (missing.length === 0) return;
    const t = Date.now();
    const next = { ...last };
    for (const it of missing) next[it.id] = t;
    setLast(next);
  }, [items, last, setLast]);

  // fire reminders when interval elapsed (only when active)
  useEffect(() => {
    if (!active) return;
    for (const it of items) {
      const l = last[it.id] ?? now;
      if (now - l >= it.minutes * 60_000) {
        playReminder();
        toast.info(`${it.emoji} Hora de: ${it.label}`);
        setLast({ ...last, [it.id]: now });
      }
    }
  }, [now, active, items, last, setLast]);

  function resetItem(id: SaudeItem["id"]) {
    setLast({ ...last, [id]: Date.now() });
    playClick();
    toast(`Timer reiniciado`);
  }
  function updateMinutes(id: SaudeItem["id"], minutes: number) {
    setItems(items.map((i) => i.id === id ? { ...i, minutes: Math.max(1, minutes) } : i));
    setLast({ ...last, [id]: Date.now() });
  }

  return (
    <Card title="❤ Saúde" action={
      <button onClick={() => { setActive(!active); playClick(); toast(active ? "Lembretes pausados" : "Lembretes ativados"); }} className="text-sm text-primary hover:underline">
        {active ? "Pausar" : "Ativar"}
      </button>
    }>
      <div className="grid grid-cols-2 gap-2">
        {items.map((it) => {
          const elapsed = now - (last[it.id] ?? now);
          const total = it.minutes * 60_000;
          const remain = Math.max(0, total - elapsed);
          const pct = Math.min(100, Math.round((elapsed / total) * 100));
          const mm = String(Math.floor(remain / 60_000)).padStart(2, "0");
          const ss = String(Math.floor((remain % 60_000) / 1000)).padStart(2, "0");
          return (
            <button
              key={it.id}
              onClick={() => resetItem(it.id)}
              className="group rounded-md border border-border bg-secondary/40 p-3 text-center transition hover:border-primary"
              title="Clique para reiniciar"
            >
              <div className="text-xl" style={{ color: it.color }}>{it.emoji}</div>
              <div className="mt-1 text-sm font-medium">{it.label}</div>
              <div className="mt-1 font-mono text-xs text-muted-foreground">{mm}:{ss}</div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-secondary">
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: it.color }} />
              </div>
              <div className="mt-1 flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
                <input
                  type="number"
                  min={1}
                  max={240}
                  value={it.minutes}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => updateMinutes(it.id, Number(e.target.value))}
                  className="w-12 rounded-md bg-transparent text-center outline-none"
                />
                <span>min</span>
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-3 text-center text-xs">
        {active ? <span className="text-emerald-400">● Lembretes ativos</span> : <span className="text-muted-foreground">Clique em um card para reiniciar o timer</span>}
      </div>
    </Card>
  );
}

/* ---------- métricas do mês ---------- */

function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function MetricasMes() {
  const [history] = useLocal<MetricsHistory>("metrics-history-v1", {});
  const mk = monthKey();
  const entries = Object.entries(history).filter(([day]) => day.startsWith(mk));
  const totalDone = entries.reduce((a, [, v]) => a + v.done, 0);
  const totalAll = entries.reduce((a, [, v]) => a + v.total, 0);
  const avg = totalAll ? Math.round((totalDone / totalAll) * 100) : 0;
  const daysWithData = entries.length;
  const daysFull = entries.filter(([, v]) => v.total > 0 && v.done === v.total).length;

  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const map = new Map(entries);

  const monthLabel = now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <Card title={`📊 Métricas do Mês — ${monthLabel}`}>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-md border border-border bg-secondary/40 p-3">
          <div className="text-2xl font-bold text-primary">{avg}%</div>
          <div className="text-xs text-muted-foreground">Meta de rotina</div>
        </div>
        <div className="rounded-md border border-border bg-secondary/40 p-3">
          <div className="text-2xl font-bold">{daysFull}</div>
          <div className="text-xs text-muted-foreground">Dias 100%</div>
        </div>
        <div className="rounded-md border border-border bg-secondary/40 p-3">
          <div className="text-2xl font-bold">{daysWithData}</div>
          <div className="text-xs text-muted-foreground">Dias ativos</div>
        </div>
      </div>
      <div className="mt-4">
        <div className="mb-2 text-xs text-muted-foreground">Cumprimento diário</div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(28px,1fr))] gap-1">
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1;
            const key = `${now.getFullYear()}-${now.getMonth() + 1}-${day}`;
            const v = map.get(key);
            const pct = v && v.total ? Math.round((v.done / v.total) * 100) : 0;
            const isFuture = day > now.getDate();
            return (
              <div
                key={day}
                title={v ? `${day}: ${v.done}/${v.total} (${pct}%)` : `${day}: sem dados`}
                className="flex aspect-square items-center justify-center rounded text-[10px] font-medium"
                style={{
                  background: isFuture
                    ? "transparent"
                    : v
                      ? `color-mix(in oklch, var(--color-primary) ${pct}%, var(--color-secondary))`
                      : "var(--color-secondary)",
                  color: pct > 50 ? "var(--color-primary-foreground)" : "var(--color-muted-foreground)",
                  border: isFuture ? "1px dashed var(--color-border)" : undefined,
                }}
              >
                {day}
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-3 text-center text-[11px] text-muted-foreground">Reseta automaticamente todo mês</div>
    </Card>
  );
}

/* ---------- semana (aprendizados / metas) ---------- */

function SemanaCard({ storageKey, title }: { storageKey: string; title: string }) {
  const [state, setState] = useLocal<WeeklyList<{ id: string; text: string; done: boolean }>>(storageKey, { items: [], week: weekKey() });
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");

  useEffect(() => {
    if (state.week !== weekKey()) setState({ items: [], week: weekKey() });
  }, [state.week, setState]);

  function add(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setState((s) => ({ ...s, items: [...s.items, { id: uid(), text: t, done: false }] }));
    setText("");
    setAdding(false);
    playClick();
    toast.success("Item adicionado");
  }
  function toggle(id: string) {
    setState((s) => ({ ...s, items: s.items.map((i) => i.id === id ? { ...i, done: !i.done } : i) }));
    playSuccess();
  }
  function del(id: string) {
    if (!confirm("Deletar item?")) return;
    setState((s) => ({ ...s, items: s.items.filter((i) => i.id !== id) }));
    toast("Item removido");
  }

  return (
    <Card title={title} action={
      <button onClick={() => setAdding((v) => !v)} className="rounded-md p-1 text-muted-foreground hover:text-primary" aria-label="Adicionar">+</button>
    }>
      {adding && (
        <form onSubmit={add} className="mb-3 flex gap-2">
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Adicionar item..." className="flex-1 rounded-md border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary" />
          <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">+</button>
        </form>
      )}
      {state.items.length === 0 && !adding && <EmptyState label="Nenhum item ainda" />}
      <ul className="flex flex-col gap-2">
        {state.items.map((i) => (
          <li key={i.id} className="group flex items-center gap-3 rounded-md border border-border bg-secondary/40 px-3 py-2">
            <input type="checkbox" checked={i.done} onChange={() => toggle(i.id)} className="h-4 w-4 accent-[var(--color-primary)]" />
            <span className={`flex-1 text-sm ${i.done ? "text-muted-foreground line-through" : ""}`}>{i.text}</span>
            <button onClick={() => del(i.id)} className="rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100">×</button>
          </li>
        ))}
      </ul>
      <div className="mt-3 text-center text-[11px] text-muted-foreground">Reseta toda segunda-feira</div>
    </Card>
  );
}

/* ---------- kanban ---------- */

type KanbanCol = keyof KanbanState;
const KANBAN_COLS: { key: KanbanCol; label: string }[] = [
  { key: "todo", label: "A Fazer" },
  { key: "doing", label: "Em Progresso" },
  { key: "done", label: "Concluído" },
];

function KanbanBoard() {
  const [state, setState] = useLocal<KanbanState>("kanban-v1", { todo: [], doing: [], done: [] });
  const [drafts, setDrafts] = useState<Record<KanbanCol, string>>({ todo: "", doing: "", done: "" });
  const dragRef = useRef<{ from: KanbanCol; id: string } | null>(null);

  function add(col: KanbanCol) {
    const t = drafts[col].trim();
    if (!t) return;
    setState((s) => ({ ...s, [col]: [...s[col], { id: uid(), text: t }] }));
    setDrafts((d) => ({ ...d, [col]: "" }));
    playClick();
    toast.success("Card adicionado");
  }
  function del(col: KanbanCol, id: string) {
    if (!confirm("Deletar card?")) return;
    setState((s) => ({ ...s, [col]: s[col].filter((c) => c.id !== id) }));
  }
  function onDrop(target: KanbanCol) {
    const d = dragRef.current;
    if (!d || d.from === target) return;
    setState((s) => {
      const card = s[d.from].find((c) => c.id === d.id);
      if (!card) return s;
      return {
        ...s,
        [d.from]: s[d.from].filter((c) => c.id !== d.id),
        [target]: [...s[target], card],
      } as KanbanState;
    });
    dragRef.current = null;
    playSuccess();
    toast.success("Card movido");
  }

  return (
    <Card title="Kanban Board">
      <div className="grid gap-3 md:grid-cols-3">
        {KANBAN_COLS.map((col) => (
          <div
            key={col.key}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(col.key)}
            className="flex min-h-[180px] flex-col rounded-md border border-border bg-secondary/30 p-3"
          >
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium">{col.label}</span>
              <span className="rounded-full bg-secondary px-2 text-xs text-muted-foreground">{state[col.key].length}</span>
            </div>
            <ul className="flex flex-1 flex-col gap-2">
              {state[col.key].length === 0 && (
                <li className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">Arraste aqui</li>
              )}
              {state[col.key].map((c) => (
                <li
                  key={c.id}
                  draggable
                  onDragStart={() => { dragRef.current = { from: col.key, id: c.id }; }}
                  className="group flex cursor-grab items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm active:cursor-grabbing"
                >
                  <span className="flex-1">{c.text}</span>
                  <button onClick={() => del(col.key, c.id)} className="rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100">×</button>
                </li>
              ))}
            </ul>
            <form
              onSubmit={(e) => { e.preventDefault(); add(col.key); }}
              className="mt-2 flex gap-2"
            >
              <input
                value={drafts[col.key]}
                onChange={(e) => setDrafts((d) => ({ ...d, [col.key]: e.target.value }))}
                placeholder="+ Adicionar"
                className="flex-1 rounded-md border border-border bg-input px-2 py-1 text-xs outline-none focus:border-primary"
              />
            </form>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------- blocos rotina ---------- */

function BlocosRotina() {
  const [state, setState] = useLocal<BlocksState>("rotina-diaria-v1", { tasks: { 1: [], 2: [], 3: [], 4: [] }, lastDay: todayKey() });
  const [drafts, setDrafts] = useState<Record<number, string>>({ 1: "", 2: "", 3: "", 4: "" });
  const [addingFor, setAddingFor] = useState<number | null>(null);
  const [, setMetrics] = useLocal<MetricsHistory>("metrics-history-v1", {});

  // log today's progress whenever tasks change
  useEffect(() => {
    const all = Object.values(state.tasks).flat();
    const done = all.filter((t) => t.done).length;
    const total = all.length;
    setMetrics((m) => ({ ...m, [todayKey()]: { done, total } }));
  }, [state.tasks, setMetrics]);

  // reset checks on day change
  useEffect(() => {
    if (state.lastDay === todayKey()) return;
    setState((s) => {
      const tasks: Record<number, Task[]> = { 1: [], 2: [], 3: [], 4: [] };
      for (const k of Object.keys(s.tasks)) tasks[Number(k)] = s.tasks[Number(k)].map((t) => ({ ...t, done: false }));
      return { tasks, lastDay: todayKey() };
    });
  }, [state.lastDay, setState]);

  const addTask = useCallback((bid: number) => {
    const t = drafts[bid].trim();
    if (!t) return;
    setState((s) => ({ ...s, tasks: { ...s.tasks, [bid]: [...s.tasks[bid], { id: uid(), text: t, done: false }] } }));
    setDrafts((d) => ({ ...d, [bid]: "" }));
    setAddingFor(null);
    playClick();
    toast.success("Tarefa adicionada");
  }, [drafts, setState]);

  function toggle(bid: number, tid: string) {
    setState((s) => ({ ...s, tasks: { ...s.tasks, [bid]: s.tasks[bid].map((t) => t.id === tid ? { ...t, done: !t.done } : t) } }));
    const task = state.tasks[bid].find((t) => t.id === tid);
    if (task && !task.done) {
      playSuccess();
      toast.success("Tarefa concluída!", { description: `"${task.text}" marcada como concluída` });
    }
  }
  function del(bid: number, tid: string) {
    if (!confirm("Deletar esta tarefa?")) return;
    setState((s) => ({ ...s, tasks: { ...s.tasks, [bid]: s.tasks[bid].filter((t) => t.id !== tid) } }));
    toast("Tarefa removida");
  }
  function resetAll() {
    if (!confirm("Resetar todas as marcações?")) return;
    setState((s) => {
      const tasks: Record<number, Task[]> = { 1: [], 2: [], 3: [], 4: [] };
      for (const k of Object.keys(s.tasks)) tasks[Number(k)] = s.tasks[Number(k)].map((t) => ({ ...t, done: false }));
      return { ...s, tasks };
    });
    toast.success("Rotina resetada");
  }

  return (
    <div className="flex flex-col gap-5">
      {BLOCKS.map((b) => {
        const tasks = state.tasks[b.id] ?? [];
        const done = tasks.filter((t) => t.done).length;
        const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
        return (
          <Card
            key={b.id}
            accent={b.color}
            title={b.title}
            action={
              <button onClick={() => setAddingFor(addingFor === b.id ? null : b.id)} className="rounded-md p-1 text-muted-foreground hover:text-primary" aria-label="Adicionar">+</button>
            }
          >
            <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
              <span>{done}/{tasks.length} concluídas</span>
              <span className="rounded-full bg-secondary px-2 py-0.5">{pct}%</span>
            </div>
            <div className="mb-3 h-1 overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-gradient-to-r from-primary to-fuchsia-400 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <ul className="flex flex-col gap-2">
              {tasks.length === 0 && <li className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">Nenhuma tarefa ainda</li>}
              {tasks.map((t) => (
                <li key={t.id} className="group flex items-center gap-3 rounded-md border border-border bg-secondary/40 px-3 py-2">
                  <input type="checkbox" checked={t.done} onChange={() => toggle(b.id, t.id)} className="h-4 w-4 accent-[var(--color-primary)]" />
                  <span className={`flex-1 text-sm ${t.done ? "text-muted-foreground line-through" : ""}`}>{t.text}</span>
                  <button onClick={() => del(b.id, t.id)} className="rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100">×</button>
                </li>
              ))}
            </ul>
            {addingFor === b.id && (
              <form onSubmit={(e) => { e.preventDefault(); addTask(b.id); }} className="mt-3 flex gap-2">
                <input autoFocus value={drafts[b.id]} onChange={(e) => setDrafts((d) => ({ ...d, [b.id]: e.target.value }))} placeholder="Nova tarefa..." className="flex-1 rounded-md border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary" />
                <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">✓</button>
                <button type="button" onClick={() => setAddingFor(null)} className="rounded-md border border-border px-3 py-2 text-sm">×</button>
              </form>
            )}
          </Card>
        );
      })}
      <div className="text-center">
        <button onClick={resetAll} className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-5 py-2 text-sm text-muted-foreground hover:text-foreground">
          ↻ Resetar Rotina
        </button>
      </div>
    </div>
  );
}
