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

  const { sessionId } = await sendMessage("Recording.createSession", { recordingId });
  console.log(`Session ${sessionId}`);
  gSessionId = sessionId;

  sendMessage("Debugger.findScripts", {}, sessionId);
}

function onScript({ scriptId, url }) {
  console.log("OnScript", scriptId, url);
  const elem = document.createElement("div");
  elem.innerText = url;
  document.body.appendChild(elem);
  elem.addEventListener("click", async () => {
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

    sendMessage("Analysis.runAnalysis", { analysisId });
  });
}

// The mapper runs at function entry points and produces key/value pairs where
// keys have the form { functionName, location, index, parameterName },
// and values are the string type of that parameter.
const typeMapper = `
  const { point, time } = input;
  const { frame: { frameId, functionName, location } } = sendMessage("Pause.getTopFrame");
  const { parameters } = sendMessage("Pause.getFrameParameters", { frameId });

  const entries = [];
  parameters.forEach((param, index) => {
    const key = { functionName, location, index, parameterName: param.name };
    const value = valueType(param);
    entries.push({ key, value });
  }
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
  return [...new Set(values)];
`;

function onAnalysisResult({ analysisId, results }) {
  console.log("AnalysisResult", analysisId, results);
}
