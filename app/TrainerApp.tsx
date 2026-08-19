"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Point = [number, number];
type Route = { id: string; label: string; kind: "TAXI" | "LINE_UP" | "TAKEOFF"; points: Point[]; durationMs: number };
type TrainerSession = {
  id: string;
  state: string;
  stateVersion: number;
  controller: "GROUND" | "TOWER";
  frequency: string;
  lastControllerText: string | null;
  visibleRouteIds: string[];
  aircraftProgress: number;
  movementRouteId: string | null;
  consecutiveFailures: number;
  hintAvailable: boolean;
  assistance: { sayAgain: number; transcriptReveals: number; hints: number };
  currentStep: { id: string; instructionType: string; requiredFields: string[]; suggestedPhrase: string } | null;
  progress: { current: number; total: number };
  copy: { title: string; detail: string; tag: string };
  scenario: {
    aircraft: { type: string; callsign: string };
    airport: { icao: string; name: string; groundFrequency: string; towerFrequency: string; runway: string };
    startPositionId: string;
    startPosition: Point;
    holdingPoint: string;
    taxiways: string[];
    routes: Record<string, Route>;
    validationStatus: string;
  };
  provider: "OPENAI" | "LOCAL_DEMO";
  completed: boolean;
};

type ControllerReply = { text: string; audioDataUrl: string | null; playbackRate: number };
type Validation = {
  status: "ACCEPTED" | "CORRECTION_REQUIRED" | "CLARIFICATION_REQUIRED";
  fieldResults: Array<{ field: string; expected: string | string[]; received?: string | string[]; correct: boolean }>;
};
type Debrief = {
  metrics: {
    totalAttempts: number;
    acceptedTransmissions: number;
    corrections: number;
    sayAgainUses: number;
    transcriptReveals: number;
    hintsUsed: number;
    accuracyPercent: number;
  };
  strengths: string[];
  improvements: string[];
  nextPracticeFocus: string;
  transcript: Array<{ speaker: string; text: string; status: string; at: string }>;
};

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string; confidence: number }; isFinal: boolean }> }) => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
};

function requestId() {
  return crypto.randomUUID();
}

function positionAlong(points: Point[], progress: number): Point {
  if (!points.length) return [43, 76];
  if (points.length === 1) return points[0];
  const lengths = points.slice(1).map((point, index) => Math.hypot(point[0] - points[index][0], point[1] - points[index][1]));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let remaining = Math.max(0, Math.min(1, progress)) * total;
  for (let index = 0; index < lengths.length; index += 1) {
    if (remaining <= lengths[index]) {
      const ratio = lengths[index] ? remaining / lengths[index] : 0;
      return [
        points[index][0] + (points[index + 1][0] - points[index][0]) * ratio,
        points[index][1] + (points[index + 1][1] - points[index][1]) * ratio,
      ];
    }
    remaining -= lengths[index];
  }
  return points.at(-1) ?? points[0];
}

function restoredPosition(session: TrainerSession): Point {
  if (session.movementRouteId) {
    const route = session.scenario.routes[session.movementRouteId];
    if (route) return positionAlong(route.points, session.aircraftProgress);
  }
  const latest = session.visibleRouteIds.map((id) => session.scenario.routes[id]).filter(Boolean).at(-1);
  return latest?.points.at(-1) ?? session.scenario.startPosition;
}

async function readJson(response: Response) {
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error ?? "REQUEST_FAILED") as Error & { details?: unknown; status?: number };
    error.details = data.details;
    error.status = response.status;
    throw error;
  }
  return data;
}

export function TrainerApp() {
  const [session, setSession] = useState<TrainerSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState<"CONNECTED" | "WORKING" | "OFFLINE">("CONNECTED");
  const [feedback, setFeedback] = useState<{ status: Validation["status"]; text: string; fields: string[] } | null>(null);
  const [revealedTranscript, setRevealedTranscript] = useState<string | null>(null);
  const [hint, setHint] = useState<{ text: string; phrase: string } | null>(null);
  const [nudgeStateVersion, setNudgeStateVersion] = useState<number | null>(null);
  const [audioState, setAudioState] = useState<"READY" | "RECORDING" | "PROCESSING" | "PLAYING">("READY");
  const [moving, setMoving] = useState(false);
  const [aircraftPosition, setAircraftPosition] = useState<Point>([50, 50]);
  const [zoom, setZoom] = useState(1.08);
  const [offset, setOffset] = useState({ x: 0, y: 4 });
  const [textInput, setTextInput] = useState("");
  const [debrief, setDebrief] = useState<Debrief | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const spokenRef = useRef("");
  const confidenceRef = useRef(0.99);
  const chunksRef = useRef<Blob[]>([]);
  const animatedVersions = useRef(new Set<string>());
  const dragRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const stateActionInFlightRef = useRef(false);

  const createNewSession = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    setHint(null);
    setRevealedTranscript(null);
    setDebrief(null);
    try {
      const data = await readJson(await fetch("/api/sessions", { method: "POST" }));
      localStorage.setItem("atcTrainerSessionId", data.session.id);
      setSession(data.session);
      setAircraftPosition(data.session.scenario.startPosition);
      setConnection("CONNECTED");
    } catch {
      setConnection("OFFLINE");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const boot = async () => {
      const savedId = localStorage.getItem("atcTrainerSessionId");
      if (savedId) {
        try {
          const data = await readJson(await fetch(`/api/sessions/${savedId}`));
          if (!active) return;
          setSession(data.session);
          setAircraftPosition(restoredPosition(data.session));
          setLoading(false);
          return;
        } catch {
          localStorage.removeItem("atcTrainerSessionId");
        }
      }
      if (active) await createNewSession();
    };
    void boot();
    return () => { active = false; };
  }, [createNewSession]);

  useEffect(() => {
    if (!session?.currentStep || moving || session.completed) return;
    const timer = window.setTimeout(() => setNudgeStateVersion(session.stateVersion), 15_000);
    return () => window.clearTimeout(timer);
  }, [session?.stateVersion, session?.currentStep, moving, session?.completed]);

  const playController = useCallback(async (reply?: ControllerReply | null) => {
    if (!reply?.text) return;
    setAudioState("PLAYING");
    try {
      if (reply.audioDataUrl) {
        const audio = new Audio(reply.audioDataUrl);
        audio.playbackRate = reply.playbackRate;
        await audio.play();
        await new Promise<void>((resolve) => { audio.onended = () => resolve(); audio.onerror = () => resolve(); });
      } else if ("speechSynthesis" in window) {
        await new Promise<void>((resolve) => {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(reply.text);
          utterance.rate = Math.min(1, reply.playbackRate * 0.92);
          utterance.pitch = 0.82;
          utterance.onend = () => resolve();
          utterance.onerror = () => resolve();
          window.speechSynthesis.speak(utterance);
        });
      }
    } finally {
      setAudioState("READY");
    }
  }, []);

  const applyResponse = useCallback((data: { session: TrainerSession; controllerReply?: ControllerReply | null }) => {
    setSession(data.session);
    setConnection("CONNECTED");
    if (data.controllerReply) void playController(data.controllerReply);
  }, [playController]);

  const postStateAction = useCallback(async (path: string) => {
    if (!session || stateActionInFlightRef.current) return null;
    stateActionInFlightRef.current = true;
    setConnection("WORKING");
    try {
      const data = await readJson(await fetch(`/api/sessions/${session.id}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: requestId(), stateVersion: session.stateVersion, ...(path === "actions" ? { action: "MOVEMENT_COMPLETE" } : {}) }),
      }));
      applyResponse(data);
      return data;
    } catch (error) {
      const requestError = error as Error & { details?: { id?: string }; status?: number };
      if (requestError.details && "id" in requestError.details) setSession(requestError.details as TrainerSession);
      setConnection(requestError.status === 409 ? "CONNECTED" : "OFFLINE");
      setFeedback({
        status: "CLARIFICATION_REQUIRED",
        text: requestError.status === 409
          ? "The exercise updated at the same moment. Please try again."
          : "We couldn’t complete that request. Please try again.",
        fields: [],
      });
      return null;
    } finally {
      stateActionInFlightRef.current = false;
    }
  }, [session, applyResponse]);

  useEffect(() => {
    if (!session?.movementRouteId) {
      return;
    }
    const route = session.scenario.routes[session.movementRouteId];
    if (!route) return;
    const key = `${session.id}:${session.stateVersion}:${route.id}`;
    if (animatedVersions.current.has(key)) return;
    animatedVersions.current.add(key);
    setMoving(true);
    setFeedback(null);
    const startedAt = performance.now();
    let frame = 0;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / route.durationMs);
      const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      setAircraftPosition(positionAlong(route.points, eased));
      if (progress < 1) {
        frame = requestAnimationFrame(animate);
      } else {
        setMoving(false);
        void postStateAction("actions");
      }
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [session, postStateAction]);

  useEffect(() => {
    if (!session?.completed || debrief) return;
    void (async () => {
      try {
        const data = await readJson(await fetch(`/api/sessions/${session.id}/debrief`));
        setDebrief(data);
      } catch { /* debrief can be retried on refresh */ }
    })();
  }, [session?.completed, session?.id, debrief]);

  const submitTransmission = useCallback(async (transcript?: string, audio?: Blob, confidence = 0.99) => {
    if (!session || moving || audioState === "PROCESSING") return;
    setAudioState("PROCESSING");
    setConnection("WORKING");
    setFeedback(null);
    setHint(null);
    setRevealedTranscript(null);
    try {
      const form = new FormData();
      form.append("requestId", requestId());
      form.append("stateVersion", String(session.stateVersion));
      if (transcript?.trim()) form.append("transcript", transcript.trim());
      form.append("confidence", String(confidence));
      if (audio?.size) form.append("audio", audio, "transmission.webm");
      const data = await readJson(await fetch(`/api/sessions/${session.id}/transmissions`, { method: "POST", body: form }));
      const validation = data.validation as Validation;
      const incorrect = validation.fieldResults.filter((field) => !field.correct).map((field) => field.field.replaceAll("_", " ").toLowerCase());
      setFeedback({
        status: validation.status,
        text: validation.status === "ACCEPTED"
          ? "Readback accepted."
          : validation.status === "CLARIFICATION_REQUIRED"
            ? "Transmission unclear — this attempt was not scored."
            : `Check your ${incorrect.join(", ")}.`,
        fields: incorrect,
      });
      setTextInput("");
      applyResponse(data);
    } catch (error) {
      const requestError = error as Error & { details?: TrainerSession; status?: number };
      if (requestError.details?.id) setSession(requestError.details);
      setConnection(requestError.status === 409 ? "CONNECTED" : "OFFLINE");
      setFeedback({
        status: "CLARIFICATION_REQUIRED",
        text: requestError.message === "TRANSCRIPTION_UNAVAILABLE"
          ? "Voice transcription is not configured in this build. Use the text test console or add the server provider key."
          : "We couldn’t process that transmission. Please transmit again.",
        fields: [],
      });
    } finally {
      setAudioState("READY");
    }
  }, [session, moving, audioState, applyResponse]);

  const startRecording = useCallback(async () => {
    if (!session?.currentStep || moving || audioState !== "READY") return;
    try {
      spokenRef.current = "";
      confidenceRef.current = 0.99;
      chunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());
        void submitTransmission(spokenRef.current, blob, confidenceRef.current);
      };
      const speechWindow = window as unknown as {
        SpeechRecognition?: new () => BrowserSpeechRecognition;
        webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
      };
      const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
      if (Recognition) {
        const recognition = new Recognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-SG";
        recognition.onresult = (event) => {
          let transcript = "";
          let confidence = 0.99;
          for (let i = 0; i < event.results.length; i += 1) {
            transcript += `${event.results[i][0].transcript} `;
            if (event.results[i].isFinal) confidence = event.results[i][0].confidence || confidence;
          }
          spokenRef.current = transcript.trim();
          confidenceRef.current = confidence;
        };
        recognitionRef.current = recognition;
        recognition.start();
      }
      recorder.start(100);
      setAudioState("RECORDING");
    } catch {
      setFeedback({ status: "CLARIFICATION_REQUIRED", text: "Microphone access is required for push-to-talk. You can still use the text test console.", fields: [] });
    }
  }, [session?.currentStep, moving, audioState, submitTransmission]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
    recognitionRef.current = null;
  }, []);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.code === "Space" && !event.repeat && !target?.matches("input, textarea, button")) {
        event.preventDefault();
        void startRecording();
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space" && audioState === "RECORDING") {
        event.preventDefault();
        stopRecording();
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [startRecording, stopRecording, audioState]);

  const requestTranscript = async () => {
    if (revealedTranscript) { setRevealedTranscript(null); return; }
    const data = await postStateAction("transcript-reveals");
    if (data?.transcript) setRevealedTranscript(data.transcript);
  };

  const requestHint = async () => {
    const data = await postStateAction("hints");
    if (data?.hint) setHint({ text: data.hint, phrase: data.suggestedPhrase });
  };

  const routes = useMemo(() => session
    ? session.visibleRouteIds.map((id) => session.scenario.routes[id]).filter(Boolean)
    : [], [session]);

  const journey = useMemo(() => session ? [
    [`At ${formatPositionId(session.scenario.startPositionId)}`, "Contact Ground"],
    ["Taxi clearance", `Read back ${session.scenario.taxiways.join(" / ")}`],
    [`Holding ${session.scenario.holdingPoint}`, "Contact Tower"],
    [`Runway ${session.scenario.airport.runway}`, "Line up"],
    ["Takeoff", "Read back clearance"],
    ["Airborne", "Review debrief"],
  ] : [], [session]);

  if (loading || !session) {
    return (
      <main className="trainer-loading">
        <span className="brand-mark">A</span>
        <p>{connection === "OFFLINE" ? "Unable to start the trainer." : "Preparing Seletar departure…"}</p>
        {connection === "OFFLINE" && <button onClick={() => void createNewSession()}>Try again</button>}
      </main>
    );
  }

  if (session.completed && debrief) {
    return <DebriefView session={session} debrief={debrief} onRestart={() => void createNewSession()} />;
  }

  const isDisabled = moving || !session.currentStep || audioState === "PROCESSING" || audioState === "PLAYING";
  const assistanceDisabled = connection === "WORKING" || audioState !== "READY" || moving || Boolean(session.movementRouteId);
  const validationPending = session.scenario.validationStatus !== "SME_APPROVED";
  const showNudge = nudgeStateVersion === session.stateVersion;
  const displayedAircraftPosition = !moving && !session.movementRouteId
    ? restoredPosition(session)
    : aircraftPosition;

  return (
    <main className="trainer-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">A</span>
          <div><p className="eyebrow">AI ATC TRAINER</p><h1>Seletar departure</h1></div>
        </div>
        <div className="flight-summary" aria-label="Exercise details">
          <span><small>Aircraft</small> {aircraftName(session.scenario.aircraft.type)}</span>
          <span><small>Callsign</small> {session.scenario.aircraft.callsign}</span>
          <span className={`status-pill ${validationPending ? "pending" : ""}`}><i /> {validationPending ? "Validation draft" : "Training mode"}</span>
          <button className="topbar-link" onClick={() => setShowAbout(true)}>About</button>
        </div>
      </header>

      <section className="workspace">
        <aside className="journey-panel" aria-label="Exercise progress">
          <div className="section-heading"><p className="eyebrow">YOUR FLIGHT</p><span>{String(session.progress.current).padStart(2, "0")} / 06</span></div>
          <ol className="journey-list">
            {journey.map(([title, detail], index) => (
              <li key={title} className={index + 1 === session.progress.current ? "active" : index + 1 < session.progress.current ? "done" : ""}>
                <b>{index + 1 < session.progress.current ? "✓" : String(index + 1).padStart(2, "0")}</b>
                <span><strong>{title}</strong><small>{detail}</small></span>
              </li>
            ))}
          </ol>
          <div className="notice-card"><span aria-hidden="true">i</span><p><strong>Private prototype</strong>Not for operational flight planning or navigation.</p></div>
        </aside>

        <section className="map-panel" aria-label="Seletar aerodrome chart">
          <div className="map-toolbar">
            <div><span className="live-dot" /><strong>WSSL · Seletar</strong><small>{moving ? "Aircraft moving" : "Official aerodrome chart"}</small></div>
            <div className="map-actions" aria-label="Map controls">
              <button onClick={() => setZoom((value) => Math.max(.8, value - .15))} aria-label="Zoom out">−</button>
              <button onClick={() => { setZoom(1.08); setOffset({ x: 0, y: 4 }); }} aria-label="Reset zoom">{Math.round(zoom * 100)}%</button>
              <button onClick={() => setZoom((value) => Math.min(2.2, value + .15))} aria-label="Zoom in">+</button>
            </div>
          </div>
          <div
            className={`chart-stage ${moving ? "is-moving" : ""}`}
            onWheel={(event) => { event.preventDefault(); setZoom((value) => Math.max(.8, Math.min(2.2, value + (event.deltaY < 0 ? .1 : -.1)))); }}
            onPointerDown={(event) => { dragRef.current = { x: event.clientX, y: event.clientY, startX: offset.x, startY: offset.y }; event.currentTarget.setPointerCapture(event.pointerId); }}
            onPointerMove={(event) => { if (!dragRef.current) return; setOffset({ x: dragRef.current.startX + event.clientX - dragRef.current.x, y: dragRef.current.startY + event.clientY - dragRef.current.y }); }}
            onPointerUp={() => { dragRef.current = null; }}
          >
            <div className="map-canvas" style={{ transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${zoom})` }}>
              <img src="/wssl-chart-map.png" alt="Seletar Airport official aerodrome chart" draggable={false} />
              <svg className="route-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Accepted route overlay">
                {routes.map((route) => (
                  <g key={route.id} className={`route-line route-${route.kind.toLowerCase()}`}>
                    <polyline className="route-halo" points={route.points.map((point) => point.join(",")).join(" ")} />
                    <polyline className="route-core" points={route.points.map((point) => point.join(",")).join(" ")} />
                  </g>
                ))}
              </svg>
              <span className={`aircraft-marker ${moving ? "in-motion" : ""}`} style={{ left: `${displayedAircraftPosition[0]}%`, top: `${displayedAircraftPosition[1]}%` }} aria-label="Aircraft position">
                <i>✦</i><b>{session.scenario.aircraft.callsign}</b>
              </span>
            </div>
            <div className="map-message"><span>Position</span><strong>{moving ? "Moving on accepted route" : positionLabel(session)}</strong></div>
            {routes.length === 0 && <div className="route-locked"><span>Route locked</span><small>Correct readback required</small></div>}
          </div>
          <p className="attribution">© Civil Aviation Authority of Singapore · AD-2-WSSL-ADC-1-1 · Licensed training prototype</p>
        </section>

        <aside className="radio-panel">
          <div className="controller-card">
            <div className="section-heading"><p className="eyebrow">ACTIVE RADIO</p><span className={connection === "OFFLINE" ? "disconnected" : "connected"}>{connection === "WORKING" ? "Syncing" : connection === "OFFLINE" ? "Reconnect" : "Connected"}</span></div>
            <div className="frequency-row"><div className="tower-icon" aria-hidden="true">⌁</div><div><small>SELETAR {session.controller}</small><strong>{session.frequency}</strong></div></div>
          </div>

          <div className="instruction-card">
            <span className={`step-tag tag-${session.copy.tag.toLowerCase().replaceAll(" ", "-")}`}>{session.copy.tag}</span>
            <h2>{session.copy.title}</h2>
            <p>{session.copy.detail}</p>
            {feedback && <div className={`feedback-card feedback-${feedback.status.toLowerCase()}`} role="status"><strong>{feedback.status === "ACCEPTED" ? "Accepted" : feedback.status === "CORRECTION_REQUIRED" ? "Correction required" : "Try again"}</strong><span>{feedback.text}</span></div>}
            {revealedTranscript && <div className="transcript-card"><span>ATC transcript</span><q>{revealedTranscript}</q></div>}
            {hint && <div className="phrase-tip"><span>Coaching hint</span><p>{hint.text}</p><q>{hint.phrase}</q></div>}
            {showNudge && !hint && <button className="nudge-button" onClick={() => void requestHint()}>Need a prompt? Show a hint</button>}
          </div>

          <div className="ptt-area">
            <button
              className={`ptt-button ${audioState === "RECORDING" ? "recording" : ""}`}
              aria-label={audioState === "RECORDING" ? "Release to send" : "Hold to talk"}
              disabled={isDisabled}
              onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); void startRecording(); }}
              onPointerUp={stopRecording}
              onPointerCancel={stopRecording}
            >
              <span className="mic-glyph" aria-hidden="true">●</span>
              <strong>{audioState === "RECORDING" ? "Release to send" : moving ? "Aircraft moving" : audioState === "PROCESSING" ? "Checking readback" : audioState === "PLAYING" ? "ATC speaking" : "Hold to talk"}</strong>
              <small>{audioState === "READY" ? "or hold Space" : audioState.toLowerCase()}</small>
            </button>
            <p><span className="level-bars" aria-hidden="true">▂▄▆▄▂</span>{session.provider === "OPENAI" ? "Secure voice provider ready" : "Browser voice · demo mode"}</p>
          </div>

          <div className="assist-row">
            <button disabled={!session.lastControllerText || assistanceDisabled} onClick={() => void postStateAction("say-again")}><span aria-hidden="true">↻</span> Say again</button>
            <button disabled={!session.lastControllerText || assistanceDisabled} onClick={() => void requestTranscript()}><span aria-hidden="true">◉</span> {revealedTranscript ? "Hide transcript" : "Show transcript"}</button>
            <button disabled={!session.currentStep || assistanceDisabled} onClick={() => void requestHint()}><span aria-hidden="true">?</span> Hint</button>
          </div>

          <details className="dev-harness">
            <summary>Prototype text test console</summary>
            <form onSubmit={(event) => { event.preventDefault(); void submitTransmission(textInput); }}>
              <textarea value={textInput} onChange={(event) => setTextInput(event.target.value)} placeholder="Type a learner transmission…" rows={3} />
              <div><button type="button" onClick={() => setTextInput(session.currentStep?.suggestedPhrase ?? "")}>Load expected readback</button><button type="submit" disabled={!textInput.trim() || isDisabled}>Transmit text</button></div>
            </form>
          </details>
        </aside>
      </section>

      {showAbout && <AboutDialog session={session} onClose={() => setShowAbout(false)} onRestart={() => { setShowAbout(false); void createNewSession(); }} />}
    </main>
  );
}

function positionLabel(session: TrainerSession) {
  const { state } = session;
  const start = formatPositionId(session.scenario.startPositionId);
  const holdingPoint = session.scenario.holdingPoint;
  const runway = session.scenario.airport.runway;
  if (["PARKED", "READY_FOR_GROUND", "TAXI_READBACK_PENDING"].includes(state)) return `Parked · ${start}`;
  if (["TAXIING"].includes(state)) return `Taxiing to ${holdingPoint}`;
  if (["HOLDING_POINT", "TOWER_TRANSITION", "TOWER_CONTACT", "RUNWAY_HOLD_OR_LINE_UP"].includes(state)) return `Holding point ${holdingPoint}`;
  if (["TAKEOFF_READBACK_PENDING"].includes(state)) return `Lined up · Runway ${runway}`;
  if (["TAKEOFF_ROLL", "AIRBORNE", "COMPLETE"].includes(state)) return `Runway ${runway}`;
  return "Seletar Airport";
}

function formatPositionId(positionId: string) {
  return positionId.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function aircraftName(type: string) {
  return type === "C172" ? "Cessna 172" : type;
}

function AboutDialog({ session, onClose, onRestart }: { session: TrainerSession; onClose(): void; onRestart(): void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title">
        <button className="dialog-close" aria-label="Close" onClick={onClose}>×</button>
        <p className="eyebrow">ABOUT THIS EXERCISE</p>
        <h2 id="about-title">A guided radio training prototype.</h2>
        <p>Practice one chart-derived {aircraftName(session.scenario.aircraft.type)} departure from Seletar using Ground and Tower calls, deterministic readback checks, and a route traced on the official aerodrome chart.</p>
        <dl><div><dt>Scenario</dt><dd>{session.scenario.airport.icao} · {session.scenario.aircraft.callsign} · Runway {session.scenario.airport.runway}</dd></div><div><dt>Start</dt><dd>{formatPositionId(session.scenario.startPositionId)} · via {session.scenario.taxiways.join(", ")} to {session.scenario.holdingPoint}</dd></div><div><dt>Data status</dt><dd>{session.scenario.validationStatus.replaceAll("_", " ")}</dd></div><div><dt>Chart</dt><dd>CAAS AD-2-WSSL-ADC-1-1 / 1-2</dd></div></dl>
        <div className="safety-callout"><strong>Training use only</strong><p>This application is not operational flight-planning, navigation, or an approved aviation training device. The draft route and phraseology require aviation SME sign-off before learner release.</p></div>
        <div className="dialog-actions"><button onClick={onRestart}>Restart exercise</button><button className="primary" onClick={onClose}>Return to training</button></div>
      </section>
    </div>
  );
}

function DebriefView({ session, debrief, onRestart }: { session: TrainerSession; debrief: Debrief; onRestart(): void }) {
  return (
    <main className="debrief-page">
      <header className="debrief-topbar"><div className="brand-lockup"><span className="brand-mark">A</span><div><p className="eyebrow">AI ATC TRAINER</p><h1>Exercise debrief</h1></div></div><span className="complete-pill">✓ Airborne</span></header>
      <section className="debrief-hero"><p className="eyebrow">SELETAR DEPARTURE · {session.scenario.aircraft.callsign}</p><h2>Nicely flown. You made it from the stand to the sky.</h2><p>Your next practice focus is <strong>{debrief.nextPracticeFocus.toLowerCase()}</strong>.</p></section>
      <section className="metric-grid" aria-label="Session metrics">
        <article><strong>{debrief.metrics.accuracyPercent}%</strong><span>First-pass accuracy</span></article>
        <article><strong>{debrief.metrics.acceptedTransmissions}</strong><span>Accepted calls</span></article>
        <article><strong>{debrief.metrics.corrections}</strong><span>Corrections</span></article>
        <article><strong>{debrief.metrics.sayAgainUses + debrief.metrics.transcriptReveals + debrief.metrics.hintsUsed}</strong><span>Assists used</span></article>
      </section>
      <section className="debrief-grid">
        <article className="coaching-card"><span className="card-kicker success">WHAT YOU DID WELL</span><ul>{debrief.strengths.map((item) => <li key={item}>{item}</li>)}</ul></article>
        <article className="coaching-card"><span className="card-kicker improve">WHAT TO IMPROVE</span><ul>{debrief.improvements.map((item) => <li key={item}>{item}</li>)}</ul></article>
        <article className="focus-card"><p className="eyebrow">NEXT PRACTICE FOCUS</p><h3>{debrief.nextPracticeFocus}</h3><p>Repeat the Seletar departure and aim to complete this element without a correction or assistance reveal.</p></article>
      </section>
      <section className="transcript-log"><div className="section-heading"><div><p className="eyebrow">FULL LEARNER TRANSCRIPT</p><h3>Radio record</h3></div><a href={`/api/sessions/${session.id}/diagnostic`} download>Export diagnostic</a></div>{debrief.transcript.map((item, index) => <div className="transcript-row" key={`${item.at}-${index}`}><b>{String(index + 1).padStart(2, "0")}</b><span><small>{item.speaker} · {item.status.replaceAll("_", " ")}</small>{item.text}</span></div>)}</section>
      <div className="debrief-actions"><button onClick={onRestart}>Practice again</button><p>Training use only · Not for operational flight planning or navigation</p></div>
    </main>
  );
}
