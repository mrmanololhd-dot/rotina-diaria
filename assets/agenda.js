// Agenda com alarme — módulo independente do app React.
(() => {
  const KEY = "rotina-agenda-v1";
  const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  const DIAS = ["D","S","T","Q","Q","S","S"];

  // ---------- dados ----------
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };
  const save = (l) => { try { localStorage.setItem(KEY, JSON.stringify(l)); } catch {} };
  let eventos = load();
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const quando = (e) => new Date(`${e.data}T${e.hora}`);
  const fmt = (e) => {
    const d = quando(e);
    return d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }) + " · " + e.hora;
  };

  // ---------- som: bip de relógio a cada 2s ----------
  let ctx = null;
  const getCtx = () => {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  };
  const bip = (when) => {
    const c = getCtx(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = "square"; o.frequency.value = 4000;
    o.connect(g).connect(c.destination);
    const t0 = c.currentTime + when, t1 = t0 + 0.08;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.12, t0 + 0.005);
    g.gain.setValueAtTime(0.12, t1 - 0.01);
    g.gain.linearRampToValueAtTime(0, t1);
    o.start(t0); o.stop(t1 + 0.02);
  };
  const bipBip = () => { bip(0); bip(0.15); };
  // navegadores só liberam áudio depois de um clique na página
  ["pointerdown", "keydown"].forEach((ev) => window.addEventListener(ev, () => getCtx(), { passive: true }));

  // ---------- alarme ----------
  let tocando = null; // { ids, timer }
  const fila = [];
  const tituloOriginal = document.title;

  function dispararAlarme(evs) {
    const novos = evs.filter((e) => !fila.find((f) => f.id === e.id));
    if (!novos.length) return;
    fila.push(...novos);
    if (tocando) { renderModal(); return; }
    bipBip();
    tocando = { timer: setInterval(() => {
      bipBip();
      document.title = document.title.startsWith("⏰") ? tituloOriginal : "⏰ " + (fila[0]?.texto || "Alarme");
    }, 2000) };
    renderModal();
    if ("Notification" in window && Notification.permission === "granted") {
      evs.forEach((e) => { try { new Notification("⏰ " + e.texto, { body: fmt(e), requireInteraction: true }); } catch {} });
    }
  }

  function desligar() {
    if (tocando) clearInterval(tocando.timer);
    tocando = null;
    const ids = fila.map((f) => f.id);
    fila.length = 0;
    eventos = eventos.map((e) => ids.includes(e.id) ? { ...e, tocou: true } : e);
    save(eventos);
    document.title = tituloOriginal;
    document.getElementById("agenda-modal")?.remove();
    render();
  }

  function adiar5() {
    const ids = fila.map((f) => f.id);
    const novo = new Date(Date.now() + 5 * 60000);
    eventos = eventos.map((e) => ids.includes(e.id) ? { ...e, data: ymd(novo), hora: `${pad(novo.getHours())}:${pad(novo.getMinutes())}`, tocou: false } : e);
    save(eventos);
    if (tocando) clearInterval(tocando.timer);
    tocando = null; fila.length = 0;
    document.title = tituloOriginal;
    document.getElementById("agenda-modal")?.remove();
    render();
  }

  function renderModal() {
    let m = document.getElementById("agenda-modal");
    if (!m) {
      m = document.createElement("div");
      m.id = "agenda-modal";
      document.body.appendChild(m);
    }
    m.innerHTML = `
      <div class="ag-modal-box" role="alertdialog" aria-live="assertive">
        <div class="ag-modal-icon">⏰</div>
        <div class="ag-modal-label">Lembrete da agenda</div>
        ${fila.map((e) => `<div class="ag-modal-texto">${esc(e.texto)}</div><div class="ag-modal-hora">${fmt(e)}</div>`).join("")}
        <button class="ag-btn ag-btn-off" id="ag-off">🔕 Desligar alarme</button>
        <button class="ag-btn ag-btn-ghost" id="ag-snooze">Lembrar em 5 min</button>
      </div>`;
    m.querySelector("#ag-off").onclick = desligar;
    m.querySelector("#ag-snooze").onclick = adiar5;
  }

  function verificar() {
    const agora = Date.now();
    const vencidos = eventos.filter((e) => !e.tocou && quando(e).getTime() <= agora);
    // eventos perdidos há mais de 24h (página fechada) não tocam, só ficam marcados
    const velhos = vencidos.filter((e) => agora - quando(e).getTime() > 86400000);
    if (velhos.length) {
      eventos = eventos.map((e) => velhos.find((v) => v.id === e.id) ? { ...e, tocou: true } : e);
      save(eventos);
    }
    const tocar = vencidos.filter((e) => !velhos.includes(e));
    if (tocar.length) dispararAlarme(tocar);
  }

  // ---------- interface ----------
  const hoje = new Date();
  let mesVisto = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  let diaSel = ymd(hoje);
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let raiz = null;

  function render() {
    if (!raiz) return;
    const ano = mesVisto.getFullYear(), mes = mesVisto.getMonth();
    const primeiro = new Date(ano, mes, 1).getDay();
    const total = new Date(ano, mes + 1, 0).getDate();
    const comEvento = new Set(eventos.filter((e) => !e.tocou).map((e) => e.data));
    let cels = "";
    for (let i = 0; i < primeiro; i++) cels += `<span></span>`;
    for (let d = 1; d <= total; d++) {
      const k = `${ano}-${pad(mes + 1)}-${pad(d)}`;
      const passado = k < ymd(new Date());
      cels += `<button type="button" data-dia="${k}" class="ag-dia${k === diaSel ? " sel" : ""}${k === ymd(new Date()) ? " hoje" : ""}${passado ? " passado" : ""}"${passado ? " disabled" : ""}>${d}${comEvento.has(k) ? '<i></i>' : ""}</button>`;
    }
    const doDia = eventos.filter((e) => e.data === diaSel).sort((a, b) => a.hora.localeCompare(b.hora));
    const proximos = eventos.filter((e) => !e.tocou).sort((a, b) => quando(a) - quando(b)).slice(0, 8);
    const [sa, sm, sd] = diaSel.split("-");

    raiz.innerHTML = `
      <div class="ag-head">
        <h2>📅 Agenda com Alarme</h2>
        <span class="ag-sub">Escolha o dia, a hora e o que é — o alarme toca na hora certa</span>
      </div>
      <div class="ag-grid">
        <div>
          <div class="ag-cal-nav">
            <button type="button" id="ag-prev" aria-label="Mês anterior">‹</button>
            <strong>${MESES[mes]} ${ano}</strong>
            <button type="button" id="ag-next" aria-label="Próximo mês">›</button>
          </div>
          <div class="ag-cal">${DIAS.map((d) => `<span class="ag-dow">${d}</span>`).join("")}${cels}</div>
        </div>
        <div>
          <form id="ag-form" class="ag-form">
            <div class="ag-sel-dia">Dia escolhido: <b>${sd}/${sm}/${sa}</b></div>
            <label>Horário<input type="time" id="ag-hora" required value="${pad((new Date().getHours() + 1) % 24)}:00"></label>
            <label>O que é?<input type="text" id="ag-texto" required maxlength="120" placeholder="Ex.: Reunião com cliente"></label>
            <button type="submit" class="ag-btn ag-btn-add">+ Adicionar evento</button>
            <div id="ag-erro" class="ag-erro"></div>
          </form>
          <div class="ag-lista-titulo">Eventos em ${sd}/${sm}</div>
          <ul class="ag-lista">${doDia.length ? doDia.map(item).join("") : `<li class="ag-vazio">Nenhum evento neste dia</li>`}</ul>
        </div>
      </div>
      <div class="ag-lista-titulo" style="margin-top:18px">Próximos alarmes</div>
      <ul class="ag-lista">${proximos.length ? proximos.map((e) => item(e, true)).join("") : `<li class="ag-vazio">Nenhum alarme agendado</li>`}</ul>
      <div class="ag-aviso">⚠️ O alarme só toca com esta página aberta (pode ficar em outra aba). Deixe o som do computador/celular ligado.</div>`;

    raiz.querySelector("#ag-prev").onclick = () => { mesVisto = new Date(ano, mes - 1, 1); render(); };
    raiz.querySelector("#ag-next").onclick = () => { mesVisto = new Date(ano, mes + 1, 1); render(); };
    raiz.querySelectorAll("[data-dia]").forEach((b) => b.onclick = () => { diaSel = b.dataset.dia; render(); });
    raiz.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => {
      eventos = eventos.filter((e) => e.id !== b.dataset.del); save(eventos); render();
    });
    raiz.querySelector("#ag-form").onsubmit = (ev) => {
      ev.preventDefault();
      const hora = raiz.querySelector("#ag-hora").value;
      const texto = raiz.querySelector("#ag-texto").value.trim();
      const erro = raiz.querySelector("#ag-erro");
      if (!hora || !texto) return;
      const novo = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), data: diaSel, hora, texto, tocou: false };
      if (quando(novo).getTime() <= Date.now()) { erro.textContent = "Esse horário já passou. Escolha um horário futuro."; return; }
      eventos.push(novo); save(eventos);
      getCtx();
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
      render();
    };
  }

  function item(e, comDia) {
    return `<li class="ag-item${e.tocou ? " feito" : ""}">
      <span class="ag-item-hora">${comDia ? fmt(e) : e.hora}</span>
      <span class="ag-item-texto">${esc(e.texto)}</span>
      ${e.tocou ? '<span class="ag-tag">tocou</span>' : '<span class="ag-tag on">⏰</span>'}
      <button type="button" data-del="${e.id}" aria-label="Excluir">✕</button>
    </li>`;
  }

  const css = `
  #agenda-section{margin-top:20px;border:1px solid var(--border);background:var(--card);color:var(--card-foreground);border-radius:.75rem;padding:20px;box-shadow:0 1px 2px rgb(0 0 0/.05)}
  #agenda-section *{box-sizing:border-box}
  .ag-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;margin-bottom:16px}
  .ag-head h2{font-size:1.125rem;font-weight:600;margin:0}
  .ag-sub{font-size:12px;color:var(--muted-foreground)}
  .ag-grid{display:grid;gap:20px}
  @media(min-width:768px){.ag-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}
  .ag-cal-nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
  .ag-cal-nav button{background:var(--secondary);color:var(--foreground);border:1px solid var(--border);border-radius:6px;width:32px;height:32px;font-size:18px;cursor:pointer}
  .ag-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
  .ag-dow{text-align:center;font-size:11px;color:var(--muted-foreground);padding:4px 0}
  .ag-dia{position:relative;aspect-ratio:1;border-radius:8px;border:1px solid transparent;background:var(--secondary);color:var(--foreground);font-size:13px;cursor:pointer}
  .ag-dia:hover:not(:disabled){border-color:var(--primary)}
  .ag-dia.hoje{border-color:var(--primary);font-weight:700}
  .ag-dia.sel{background:var(--primary);color:var(--primary-foreground);font-weight:700}
  .ag-dia.passado{opacity:.35;cursor:default}
  .ag-dia i{position:absolute;bottom:4px;left:50%;transform:translateX(-50%);width:5px;height:5px;border-radius:50%;background:#e879f9}
  .ag-dia.sel i{background:var(--primary-foreground)}
  .ag-form{display:grid;gap:10px}
  .ag-sel-dia{font-size:13px;color:var(--muted-foreground)}
  .ag-sel-dia b{color:var(--primary)}
  .ag-form label{display:grid;gap:4px;font-size:12px;color:var(--muted-foreground)}
  .ag-form input{background:var(--input);color:var(--foreground);border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:14px;color-scheme:dark;width:100%}
  .ag-form input:focus{outline:2px solid var(--ring);outline-offset:0}
  .ag-btn{border:0;border-radius:8px;padding:10px 14px;font-weight:600;font-size:14px;cursor:pointer}
  .ag-btn-add{background:var(--primary);color:var(--primary-foreground)}
  .ag-erro{font-size:12px;color:#f87171;min-height:0}
  .ag-lista-titulo{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted-foreground);margin:14px 0 6px}
  .ag-lista{list-style:none;margin:0;padding:0;display:grid;gap:6px}
  .ag-item{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;background:var(--secondary);font-size:14px}
  .ag-item.feito{opacity:.5}
  .ag-item.feito .ag-item-texto{text-decoration:line-through}
  .ag-item-hora{color:var(--primary);font-variant-numeric:tabular-nums;font-size:12px;white-space:nowrap}
  .ag-item-texto{flex:1;min-width:0;overflow-wrap:anywhere}
  .ag-tag{font-size:11px;color:var(--muted-foreground)}
  .ag-item button{background:none;border:0;color:var(--muted-foreground);cursor:pointer;font-size:14px;padding:2px 4px}
  .ag-item button:hover{color:#f87171}
  .ag-vazio{font-size:13px;color:var(--muted-foreground);padding:10px;border:1px dashed var(--border);border-radius:8px;text-align:center}
  .ag-aviso{margin-top:14px;font-size:11px;color:var(--muted-foreground)}
  #agenda-modal{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:rgb(0 0 0/.7);padding:16px}
  .ag-modal-box{width:100%;max-width:380px;background:var(--card);color:var(--foreground);border:2px solid var(--primary);border-radius:16px;padding:24px;text-align:center;display:grid;gap:10px;animation:ag-pulse 1s ease-in-out infinite alternate}
  @keyframes ag-pulse{from{box-shadow:0 0 0 0 rgb(125 211 252/.2)}to{box-shadow:0 0 0 14px rgb(125 211 252/0)}}
  .ag-modal-icon{font-size:48px;animation:ag-shake .5s linear infinite}
  @keyframes ag-shake{0%,100%{transform:rotate(0)}25%{transform:rotate(-12deg)}75%{transform:rotate(12deg)}}
  .ag-modal-label{font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted-foreground)}
  .ag-modal-texto{font-size:22px;font-weight:700;overflow-wrap:anywhere}
  .ag-modal-hora{font-size:13px;color:var(--primary)}
  .ag-btn-off{background:#ef4444;color:#fff;font-size:16px;padding:14px;margin-top:8px}
  .ag-btn-ghost{background:transparent;color:var(--muted-foreground);border:1px solid var(--border)}
  `;

  function montar() {
    if (!document.getElementById("agenda-css")) {
      const st = document.createElement("style");
      st.id = "agenda-css"; st.textContent = css;
      document.head.appendChild(st);
    }
    if (document.getElementById("agenda-section")) return;
    const footer = document.querySelector("footer");
    if (!footer) return;
    raiz = document.createElement("section");
    raiz.id = "agenda-section";
    footer.parentNode.insertBefore(raiz, footer);
    render();
  }

  function iniciar() {
    montar();
    // se o React re-renderizar e remover a seção, monta de novo
    new MutationObserver(() => { if (!document.getElementById("agenda-section")) montar(); })
      .observe(document.body, { childList: true, subtree: true });
    verificar();
    setInterval(verificar, 1000);
    let diaAtual = ymd(new Date());
    setInterval(() => { // virou o dia: atualiza o calendário
      if (ymd(new Date()) !== diaAtual) { diaAtual = ymd(new Date()); render(); }
    }, 60000);
  }

  // espera o React terminar a hidratação antes de mexer na página
  const t0 = Date.now();
  const esperar = () => (window.$_TSR && Date.now() - t0 < 5000 ? setTimeout(esperar, 100) : setTimeout(iniciar, 300));
  if (document.readyState === "complete") esperar();
  else window.addEventListener("load", esperar);
})();
