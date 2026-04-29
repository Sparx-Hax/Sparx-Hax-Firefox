const solveBtn = document.getElementById("solve");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const previewEl = document.getElementById("preview");
const debugPanel = document.getElementById("debug-panel");
const debugModel = document.getElementById("debug-model");
const debugVision = document.getElementById("debug-vision-output");

function setDebugModel(modelName, path) {
  debugPanel.style.display = "block";
  debugModel.replaceChildren();
  const label = document.createElement("span");
  label.className = "debug-label";
  label.textContent = "Final answer from";
  const name = document.createElement("span");
  name.className = "model-name";
  name.textContent = modelName;
  const pathEl = document.createElement("span");
  pathEl.className = "model-path";
  pathEl.textContent = `(${path})`;
  debugModel.append(label, name, pathEl);
}

function setDebugVision(text) {
  debugVision.replaceChildren();
  const label = document.createElement("span");
  label.className = "debug-label";
  label.textContent = "Vision → Calc AI";
  const vision = document.createElement("span");
  vision.className = "vision-text";
  vision.textContent = text || "—";
  debugVision.append(label, vision);
}

function clearDebug() {
  debugPanel.style.display = "none";
  debugModel.replaceChildren();
  debugVision.replaceChildren();
}

chrome.storage.local.get(
  ["groqApiKey", "lastAnswer", "lastScreenshot", "currentQuestion", "lastDebugModel", "lastDebugPath", "lastDebugVision"],
  (result) => {
    if (result.groqApiKey) document.getElementById("api-key").value = result.groqApiKey;
    if (result.lastAnswer) setResult(result.lastAnswer);
    if (result.lastScreenshot) {
      const img = document.createElement("img");
      img.src = result.lastScreenshot;
      previewEl.replaceChildren(img);
    }
    if (result.currentQuestion) setStatus(`Current: ${result.currentQuestion}`);
    if (result.lastDebugModel) {
      setDebugModel(result.lastDebugModel, result.lastDebugPath || "");
      setDebugVision(result.lastDebugVision || "");
    }
  }
);

document.getElementById("saveKey").addEventListener("click", () => {
  const key = document.getElementById("api-key").value.trim();
  chrome.storage.local.set({ groqApiKey: key });
});

function setStatus(msg) { statusEl.innerText = msg; }
function setResult(msg) { resultEl.innerText = msg; }
function setLoading(on) { solveBtn.disabled = on; }

solveBtn.addEventListener("click", async () => {
  const apiKey = document.getElementById("api-key").value.trim();
  if (!apiKey) return setResult("Enter your Groq API key first.");

  setLoading(true);
  setResult("");
  previewEl.replaceChildren();
  clearDebug();

  try {
    setStatus("Taking screenshot...");
    const dataUrl = await captureScreenshot();
    const img = document.createElement("img");
    img.src = dataUrl;
    previewEl.replaceChildren(img);
    const base64 = dataUrl.split(",")[1];

    setStatus("Reading question...");
    const questionText = await extractTextFromScreenshot(base64, apiKey);

    setStatus("Solving...");

    const visionOutput = questionText;
    const { result: calcAnswer, model: usedModel } = await solveQuestion(questionText, apiKey);
    const answer = calcAnswer;
    const usedPath = "llama vision → gpt-oss-120b";

    setDebugModel(usedModel, usedPath);
    setDebugVision(visionOutput ?? "(vision solved directly — no text relay)");
    chrome.storage.local.set({ lastDebugModel: usedModel, lastDebugPath: usedPath, lastDebugVision: visionOutput ?? "(vision solved directly)" });

    setResult(answer);
    setStatus(`Done. | Current: ${(await getStorage("currentQuestion")) ?? ""}`);

    chrome.storage.local.set({ lastAnswer: answer, lastScreenshot: dataUrl });

    chrome.storage.local.get(["bookwork", "currentQuestion"], (data) => {
      const bookwork = data.bookwork || [];
      const idx = bookwork.findLastIndex((e) => e.label === data.currentQuestion);
      if (idx !== -1) bookwork[idx].answer = answer;
      chrome.storage.local.set({ bookwork });
    });
  } catch (err) {
    console.error(err);
    setResult("Error: " + err.message);
    setStatus("");
  } finally {
    setLoading(false);
  }
});

function getStorage(key) {
  return new Promise((resolve) => chrome.storage.local.get([key], (r) => resolve(r[key])));
}

function captureScreenshot() {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(null, { format: "jpeg", quality: 90 }, (dataUrl) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve(dataUrl);
    });
  });
}

async function extractTextFromScreenshot(base64, apiKey) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } },
          { type: "text", text: `You are describing a Sparx maths question to a blind solver AI. Extract the COMPLETE question including all numbers, variables, fractions (a/b), exponents (x^n), roots (sqrt(x)), and multiple parts (a, b, c). If there is a graph, diagram, shape, or any visual element: describe it in full detail — axis labels, scale, plotted points/lines/curves, coordinates, angles, dimensions, shaded regions, and anything else needed to solve the question without seeing the image. Return ONLY the question text and any visual description, nothing else. Your measurements should be exact, no approximates unless the question states they are approximate. If a calculation is needed to work out an exact measurement, complete that calculation. When reading where a line passes through a graph make sure it is correct and makes logical sense. If you cannot read the number on a graph, work it out from the numbers before and after it.` }
        ]
      }]
    })
  });
  const raw = await response.text();
  const data = JSON.parse(raw);
  if (!response.ok) throw new Error(data.error?.message || "Vision API error");
  return data.choices[0].message.content;
}

async function solveQuestion(questionText, apiKey) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      max_tokens: 512,
      messages: [
        { role: "system", content: `You are an answer extractor. Return ONLY the final answer, nothing else. No steps, no working, no explanation, no sentences. Just the answer value. If multiple parts, use: a) ... b) ...` },
        { role: "user", content: `Return just the answer value. ${questionText}` }
      ]
    })
  });
  const raw = await response.text();
  const data = JSON.parse(raw);
  const modelName = data.model || "openai/gpt-oss-120b";
  console.log("solveQuestion model:", modelName, "| raw:", data.choices[0].message.content);
  if (!response.ok) throw new Error(data.error?.message || "Solver API error");
  return { result: cleanAnswer(data.choices[0].message.content), model: modelName };
}

async function solveWithVision(base64, apiKey) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      max_tokens: 512,
      messages: [
        {
          role: "system",
          content: `You are an answer extractor. Return ONLY the final answer, nothing else. No steps, no working, no explanation, no sentences. Just the answer value. If multiple parts, use: a) ... b) ...`
        },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } },
            { type: "text", text: `What is the answer to this maths question? Return just the answer value.` }
          ]
        }
      ]
    })
  });
  const raw = await response.text();
  const data = JSON.parse(raw);
  const modelName = data.model || "meta-llama/llama-4-scout-17b-16e-instruct";
  console.log("solveWithVision model:", modelName, "| raw:", data.choices[0].message.content);
  if (!response.ok) throw new Error(data.error?.message || "Vision solver error");
  return { result: cleanAnswer(data.choices[0].message.content), model: modelName };
}

function cleanAnswer(text) {
  try { text = decodeURIComponent(escape(text)); } catch {}
  text = text
    .replace(/â‰¤/g, "≤")
    .replace(/â‰¥/g, "≥")
    .replace(/â‰ /g, "≠")
    .replace(/Ã—/g, "×")
    .replace(/Ã·/g, "÷")
    .replace(/Ï€/g, "π")
    .replace(/â€"/g, "−");
  text = text.replace(/\\boxed\{([^}]+)\}/g, "$1");
  text = text.replace(/([^\s^]+)\^(-?\d+)/g, (_, base, exp) => {
    const superMap = {'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','-':'⁻'};
    return base + [...exp].map(c => superMap[c] ?? c).join('');
  });
  return text
    .trim()
    .replace(/\$\$?/g, "")
    .replace(/\\ge/g, "≥").replace(/\\le/g, "≤")
    .replace(/\\gt/g, ">").replace(/\\lt/g, "<")
    .replace(/\\neq/g, "≠").replace(/\\pm/g, "±")
    .replace(/\\times/g, "×").replace(/\\div/g, "÷")
    .replace(/\\infty/g, "∞").replace(/\\pi/g, "π")
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, "$1/$2")
    .replace(/\\sqrt\{([^}]+)\}/g, "sqrt($1)")
    .replace(/\^{([^}]+)}/g, "^$1")
    .replace(/\\/g, "")
    .trim();
}

function openTab(tabName) {
  document.querySelectorAll(".tabcontent").forEach((el) => (el.style.display = "none"));
  document.querySelectorAll(".tablinks").forEach((el) => el.classList.remove("active"));
  document.getElementById(tabName).style.display = "block";
  document.querySelector(`[data-tab="${tabName}"]`).classList.add("active");
  if (tabName === "Bookwork") renderBookwork();
}

document.querySelectorAll(".tablinks").forEach((btn) => {
  btn.addEventListener("click", () => openTab(btn.dataset.tab));
});

openTab("Answer");

function renderBookwork() {
  chrome.storage.local.get(["bookwork"], (data) => {
    const bookwork = data.bookwork || [];

    const filtered = bookwork.filter(e =>
      e.label?.length > 1 && e.answer != null && e.answer !== "..."
    );

    if (filtered.length !== bookwork.length) {
      chrome.storage.local.set({ bookwork: filtered }, () => renderBookwork());
      return;
    }

    const el = document.getElementById("Bookwork");
    el.replaceChildren();

    const clearBtn = document.createElement("button");
    clearBtn.id = "clearBookwork";
    clearBtn.className = "answerbtn";
    clearBtn.style.cssText = "background:#e53e3e;color:white;border:none;border-radius:4px;margin-bottom:6px;";
    clearBtn.textContent = "Clear Bookwork";
    el.appendChild(clearBtn);

    if (filtered.length === 0) {
      const empty = document.createElement("p");
      empty.style.cssText = "color:#999;font-size:13px";
      empty.textContent = "No questions yet.";
      el.appendChild(empty);
    } else {
      [...filtered].reverse().forEach((e) => {
        const div = document.createElement("div");
        div.style.cssText = "padding:8px 0;border-bottom:1px solid #eee";
        const strong = document.createElement("strong");
        strong.textContent = e.label;
        const span = document.createElement("span");
        span.style.cssText = "float:right;color:#4f46e5";
        span.textContent = e.answer;
        div.append(strong, span);
        el.appendChild(div);
      });
    }

    document.getElementById("clearBookwork").addEventListener("click", () => {
      chrome.storage.local.remove(["bookwork"], () => renderBookwork());
    });
  });
}