/*
BSD 3-Clause License

Copyright (c) 2020, Web Replay LLC
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

const { initSocket, sendMessage, addEventListener } = require("protocol/socket");
require("./styles.css");

const url = new URL(window.location.href);

const recordingId = url.searchParams.get("id");
let gSessionId;

addEventListener("Debugger.scriptParsed", onScript);
addEventListener("Analysis.analysisResult", onAnalysisResult);

setTimeout(initialize, 0);

async function initialize() {
  if (!recordingId) {
    const div = document.createElement("div");
    div.innerText = "Recording ID not specified";
    document.body.appendChild(div);
    return;
  }

  initSocket();

  const elem = document.createElement("div");
  document.body.appendChild(elem);
  elem.innerText = "Initializing...";

  const { sessionId } = await sendMessage("Recording.createSession", { recordingId });
  console.log(`Session ${sessionId}`);
  gSessionId = sessionId;

  elem.innerText = "Loading scripts...";

  await sendMessage("Debugger.findScripts", {}, sessionId);

  elem.parentNode.removeChild(elem);
}

const gScriptURLs = new Map();

function onScript({ scriptId, url }) {
  gScriptURLs.set(scriptId, url);

  // Ignore scripts with no URL (eval scripts etc.)
  if (!url) {
    return;
  }

  console.log("OnScript", scriptId, url);
  const elem = document.createElement("div");
  document.body.appendChild(elem);

  const urlElem = document.createElement("div");
  urlElem.className = "scriptLink";
  urlElem.innerText = url;
  elem.appendChild(urlElem);

  let resultsElem;

  urlElem.addEventListener("click", async () => {
    if (resultsElem) {
      if (resultsElem.style.display == "none") {
        resultsElem.style.display = "";
      } else {
        resultsElem.style.display = "none";
      }
      return;
    }

    resultsElem = document.createElement("div");
    elem.appendChild(resultsElem);

    resultsElem.innerText = "Analyzing...";
    console.log("AnalysisStart", url);

    const sourcePromise = sendMessage(
      "Debugger.getScriptSource",
      { scriptId },
      gSessionId
    );

    const { analysisId } = await sendMessage("Analysis.createAnalysis", {
      mapper: typeMapper,
      reducer: typeReducer,
      effectful: false,
    });

    sendMessage("Analysis.addFunctionEntryPoints", {
      analysisId,
      sessionId: gSessionId,
      scriptId,
    });

    await sendMessage("Analysis.runAnalysis", { analysisId });

    resultsElem.innerText = "";
    addAnalysisResults(resultsElem, sourcePromise, analysisId);

    console.log("AnalysisFinished", url);
  });
}

// The mapper runs at function entry points and produces key/value pairs where
// keys have the form { functionName, location, index, parameterName },
// and values are the string type of that parameter.
const typeMapper = `
  const { point, time } = input;
  const { frames } = sendCommand("Pause.getAllFrames");
  const { frameId, functionName, functionLocation } = frames[0];
  const caller = frames.length >= 2 ? frames[1].location : undefined;

  const { argumentValues } = sendCommand("Pause.getFrameArguments", { frameId });

  const entries = [];
  argumentValues.forEach((v, index) => {
    const key = { functionName, location: functionLocation, index };
    const value = { type: valueType(v), caller };
    entries.push({ key, value });
  });
  return entries;

  function valueType(v) {
    if ("value" in v) {
      if (v.value === null) {
        return "null";
      }
      return typeof v.value;
    }
    if ("unserializable" in v) {
      // Unserializable values are either numbers or BigInts, which end with "n".
      if (v.unserializable.endsWith("n")) {
        return "bigint";
      }
      return "number";
    }
    if ("object" in v) {
      return "object";
    }
    return "undefined";
  }
`;

// The reducer removes duplicates from the parameter types encountered.
const typeReducer = `
  const rv = [];
  for (const v of values) {
    if (!rv.some(({ type }) => type == v.type)) {
      rv.push(v);
    }
  }
  return rv;
`;

const gAnalysisResults = new Map();

function onAnalysisResult({ analysisId, results }) {
  console.log("AnalysisResult", analysisId, results);

  if (!gAnalysisResults.has(analysisId)) {
    gAnalysisResults.set(analysisId, []);
  }
  gAnalysisResults.get(analysisId).push(...results);
}

async function addAnalysisResults(resultsElem, sourcePromise, analysisId) {
  const { scriptSource } = await sourcePromise;
  const results = gAnalysisResults.get(analysisId);
  const resultsByLine = new Map();

  for (const entry of results) {
    const { line } = entry.key.location;
    if (resultsByLine.has(line)) {
      resultsByLine.get(line).push(entry);
    } else {
      resultsByLine.set(line, [entry]);
    }
  }

  let textElem;

  const lines = scriptSource.split("\n");
  lines.forEach((line, index) => {
    const lineno = index + 1;
    if (!textElem) {
      textElem = document.createElement("pre");
      resultsElem.appendChild(textElem);
    }
    textElem.innerText += `${lineno.toString().padEnd(5)}${line}\n`;

    const entries = resultsByLine.get(lineno);
    if (entries) {
      textElem = null;

      for (const { key: { functionName, index }, value } of entries) {
        const prefix = `${functionName || ""} arg #${index}`;
        for (const { type, caller } of value) {
          const elem = document.createElement("div");
          elem.className = "argumentType";
          resultsElem.appendChild(elem);
          let location;
          if (caller) {
            const { scriptId, line, column } = caller;
            const url = gScriptURLs.get(scriptId);
            location = `${url}:${line}:${column}`;
          } else {
            location = "<none>";
          }
          elem.innerText = `${prefix}: type ${type} caller ${location}`;
        }
      }
    }
  });
}
