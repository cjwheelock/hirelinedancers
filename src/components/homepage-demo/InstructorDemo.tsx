"use client";

import { useState } from "react";
import { ArrowRight, CalendarDays, Check, ChevronDown, MapPin, Music4, Play, RotateCcw, Search, Send, Square, UserRound, Users } from "lucide-react";
import { Stage, Window, Bar, Field, Row, States, useReducedMotion, type Act } from "./stageshow";
import "./instructor-demo.css";

type Scene = {
  screen: "search" | "profile" | "inquiry";
  city: string;
  focused: boolean;
  results: boolean;
  complete: boolean;
};

const INITIAL: Scene = { screen: "search", city: "", focused: false, results: false, complete: false };
const POSTER: Scene = { screen: "inquiry", city: "Nashville", focused: false, results: true, complete: true };
const STILL: Record<Scene["screen"], Scene> = {
  search: { ...INITIAL, city: "Nashville", results: true },
  profile: { ...POSTER, screen: "profile", complete: false },
  inquiry: POSTER
};

// The only effects are local illustration state and Stageshow cursor motion.
// There are no real form controls, account data, or submission handlers in the scene.
async function walkthrough(a: Act<Scene>) {
  await a.wait(600);
  await a.click("city");
  await a.set({ focused: true });
  await a.type("city", "Nashville");
  await a.wait(250);
  await a.click({ at: "search", x: .85, y: .5 });
  await a.set({ focused: false, results: true });
  a.mark("results");
  await a.wait(650);
  await a.click({ at: "profile", x: .9, y: .5 });
  await a.set({ screen: "profile" });
  a.mark("profile");
  await a.move("rest");
  await a.wait(1400);
  await a.click({ at: "inquire", x: .88, y: .5 });
  await a.set({ screen: "inquiry" });
  a.mark("inquiry");
  await a.move("rest");
  await a.wait(1300);
  await a.click({ at: "send", x: .85, y: .5 });
  await a.set({ complete: true });
  a.mark("complete");
  await a.move("rest");
  await a.wait(1800);
}

const tokens = {
  "--ss-font": "var(--font-sans)",
  "--ss-canvas": "#f6eee2",
  "--ss-surface": "#fffdf9",
  "--ss-chrome": "#f3eadc",
  "--ss-well": "#f6eee2",
  "--ss-text-strong": "#2a1e17",
  "--ss-text": "#4a3a2f",
  "--ss-text-faint": "#756759",
  "--ss-icon": "#4a3a2f",
  "--ss-line": "#e6d9c6",
  "--ss-accent": "#b8482a",
  "--ss-accent-soft": "#f9e7de",
  "--ss-radius-window": "18px",
  "--ss-radius-md": "10px",
  "--ss-control": "40px"
} as const;

function Person({ small = false }: { small?: boolean }) {
  return <span className={`hld-person${small ? " hld-person-small" : ""}`}><UserRound size={small ? 21 : 28} strokeWidth={1.6} /></span>;
}

export function InstructorDemo() {
  const [mode, setMode] = useState<"play" | Scene["screen"]>("play");
  const [replay, setReplay] = useState(0);
  const reduced = useReducedMotion();
  const playing = mode === "play" && !reduced;
  const poster = mode === "play" ? POSTER : STILL[mode];

  return (
    <figure className="hld-demo" aria-label="Illustrative instructor search and event inquiry demo">
      <div className="hld-demo-top"><span>See how it works</span><span className="hld-demo-label">Illustrative demo</span></div>
      <div className="hld-demo-picture" role="img" aria-label="Example walkthrough: search Nashville, view an example instructor profile, then preview an event inquiry. No inquiry is sent.">
        <div aria-hidden="true" inert>
          <Stage
            key={replay}
            width={660}
            height={512}
            compact={{ below: 520, width: 358, height: 470 }}
            initial={INITIAL}
            poster={poster}
            script={playing ? walkthrough : undefined}
            play="once"
            cursor={playing ? { at: "rest", style: "arrow", ripple: true, idle: 1000 } : undefined}
            tokens={tokens}
            className="hld-scene"
          >
            {(s) => (
              <>
                <Window url="hirelinedancers.com" lights="grey" className="hld-browser">
                  <div className="hld-appbar"><Music4 size={18} /><span>Find an instructor</span><span className="hld-example">Example</span></div>
                  <div className="hld-tracker">
                    {(["search", "profile", "inquiry"] as const).map((step, index) => (
                      <span key={step} data-current={s.screen === step || undefined} data-done={index < ["search", "profile", "inquiry"].indexOf(s.screen) || undefined}>
                        <i>{index + 1}</i>{["Search", "Profile", "Inquiry"][index]}
                      </span>
                    ))}
                  </div>
                  <div className="hld-screen-stack">
                    <div className="hld-screen" data-active={s.screen === "search" || undefined}>
                      <div className="hld-screen-title">Browse instructors near you</div>
                      <div className="hld-search-fields">
                        <Field label="City" value={s.city} placeholder="City or ZIP code" focused={s.focused} leading={<MapPin size={16} />} box={{ "data-target": "city" }} />
                        <Field label="Event type" value="Weddings" trailing={<ChevronDown size={14} />} />
                        <div className="hld-search-button" data-target="search" data-cursor="hand"><Search size={17} /><span>Search</span></div>
                      </div>
                      <div className="hld-results" data-found={s.results || undefined}>
                        <Row lead={<Person small />} title="Example instructor" subtitle="Nashville, TN" data-target="profile" data-cursor="hand" className="hld-result">
                          <ArrowRight size={18} />
                        </Row>
                        <div className="hld-result-tags"><span>Weddings</span><span>Private parties</span><span className="hld-example-profile">Example profile</span></div>
                        <Row lead={<span className="hld-filler-avatar" />} title={<Bar w={146} h={7} />} subtitle={<Bar w={99} h={5} />} className="hld-filler-row" />
                        <Row lead={<span className="hld-filler-avatar" />} title={<Bar w={116} h={7} />} subtitle={<Bar w={142} h={5} />} className="hld-filler-row" />
                      </div>
                    </div>

                    <div className="hld-screen" data-active={s.screen === "profile" || undefined}>
                      <div className="hld-profile-heading"><Person /><div><div className="hld-screen-title">Example instructor</div><span><MapPin size={13} /> Nashville, TN</span></div><span className="hld-profile-badge">Example profile</span></div>
                      <div className="hld-profile-body">
                        <div className="hld-profile-art">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src="/images/home/sunset-dance-floor.webp" alt="" width={1122} height={1402} />
                          <span>Photos &amp; videos</span>
                        </div>
                        <div className="hld-profile-details">
                          <div className="hld-detail-label">Event types</div>
                          <div className="hld-tags"><span>Weddings</span><span>Private parties</span></div>
                          <div className="hld-profile-lines"><Bar w={180} h={6} /><Bar w={150} h={6} /><Bar w={169} h={6} /></div>
                          <div className="hld-action" data-target="inquire" data-cursor="hand">Send an event inquiry <ArrowRight size={17} /></div>
                        </div>
                      </div>
                    </div>

                    <div className="hld-screen" data-active={s.screen === "inquiry" || undefined}>
                      <div className="hld-screen-title">Send an event inquiry</div>
                      <div className="hld-inquiry-to"><Person small /><div>Example instructor<span>Nashville, TN</span></div><span className="hld-sample">Example details</span></div>
                      <div className="hld-inquiry-fields">
                        <Field label="Event type" value="Weddings" leading={<Music4 size={16} />} />
                        <Field label="Event date" value="December 12" leading={<CalendarDays size={16} />} />
                        <Field label="City" value="Nashville, TN" leading={<MapPin size={16} />} />
                        <Field label="Guest count" value="40" leading={<Users size={16} />} />
                      </div>
                      <div className="hld-action hld-send" data-target="send" data-cursor="hand" data-complete={s.complete || undefined}>
                        <States value={s.complete ? "complete" : "ready"} states={{ ready: <><Send size={16} /> Preview inquiry</>, complete: <><Check size={17} /> Demo complete</> }} />
                      </div>
                      <div className="hld-confirmation" data-show={s.complete || undefined}><Check size={15} /><span>No inquiry was sent.</span></div>
                    </div>
                  </div>
                  <div className="hld-bottom-filler"><Bar w={188} h={6} /><Bar w={116} h={6} /></div>
                </Window>
                <span className="hld-cursor-rest" data-target="rest" />
              </>
            )}
          </Stage>
        </div>
      </div>
      <div className="hld-demo-controls">
        <div className="hld-step-controls" aria-label="Demo steps">
          {(["search", "profile", "inquiry"] as const).map((step, index) => (
            <button type="button" key={step} aria-pressed={mode === step} onClick={() => setMode(step)}>{index + 1}<span>{["Search", "Profile", "Inquiry"][index]}</span></button>
          ))}
        </div>
        <div className="hld-play-controls">
          {playing && <button type="button" aria-label="Stop animation" title="Stop animation" onClick={() => setMode("inquiry")}><Square size={13} /></button>}
          <button type="button" disabled={reduced} onClick={() => { setMode("play"); setReplay((n) => n + 1); }} aria-label={reduced ? "Animation off for reduced motion" : "Replay demo"}>
            {playing ? <RotateCcw size={15} /> : <Play size={15} />}<span>{reduced ? "Motion off" : "Replay"}</span>
          </button>
        </div>
      </div>
      <figcaption>Example profile and event details. No inquiry is sent.</figcaption>
    </figure>
  );
}
