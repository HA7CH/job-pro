const sessionsEl = document.getElementById("sessions");
const emptyEl = document.getElementById("empty");
const statusEl = document.getElementById("status");
const clearBtn = document.getElementById("clear");

function showStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.hidden = false;
  statusEl.classList.toggle("error", !!isError);
}

function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

async function render() {
  const r = await send({ type: "list_sessions" });
  if (!r?.ok || !r.sessions?.length) {
    sessionsEl.innerHTML = "";
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  sessionsEl.innerHTML = "";
  for (const s of r.sessions) {
    const li = document.createElement("li");
    const left = document.createElement("div");
    const right = document.createElement("button");
    left.innerHTML = `<span class="key">${s.key}</span> <span class="meta">${s.host} · ${s.captured_at?.slice(0, 19) ?? "?"}</span>`;
    right.textContent = "Export";
    right.addEventListener("click", async () => {
      const exp = await send({ type: "export_session", key: s.key });
      if (exp?.ok) {
        showStatus(
          `Saved jobpro/${s.key}.session.json — ${exp.cookieCount} cookies + headers from ${exp.host}.\n` +
            `Move it into ~/.jobpro/${s.key}.session.json for the CLI.`
        );
      } else {
        showStatus(`Export failed: ${exp?.message ?? "unknown error"}`, true);
      }
    });
    li.appendChild(left);
    li.appendChild(right);
    sessionsEl.appendChild(li);
  }
}

clearBtn.addEventListener("click", async () => {
  const r = await send({ type: "clear_sessions" });
  showStatus(r?.ok ? `Cleared ${r.cleared} session(s).` : `Failed: ${r?.message}`, !r?.ok);
  render();
});

render();
