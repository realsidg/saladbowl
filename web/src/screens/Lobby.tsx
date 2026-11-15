import { Icon } from "../components/Icon"
import { useEffect, useRef, useState } from "react"
import type { Intent, Snapshot } from "@saladbowl/shared"
import { Header } from "../components/Header"
import { QrCode } from "../components/QrCode"
import { Settings } from "../components/Settings"
import { listNames, missingWords } from "../lib/words"

type Send = (i: Intent) => boolean

export function Lobby({ snap, send }: { snap: Snapshot; send: Send }) {
  const host = snap.me.isHost
  const active = snap.players.filter((p) => !p.kicked)
  const missing = missingWords(snap)
  const hostListEmpty = snap.settings.wordSource === "host" && snap.hostWordCount === 0
  const blocker =
    active.length < 2
      ? "Waiting for at least 2 players"
      : missing.length
        ? `Waiting for ${listNames(missing)} to add words`
        : hostListEmpty
          ? "Add your word list to start"
          : null

  return (
    <main className="screen">
      <Header>Lobby</Header>
      {host && snap.inviteUrl && <Invite url={snap.inviteUrl} />}

      <section aria-label="Players">
        <h2 className="section-title">
          {active.length} {active.length === 1 ? "player" : "players"}
        </h2>
        <ul className="chips">
          {active.map((p) => (
            <li key={p.id} className={`chip${p.connected ? "" : " chip-away"}`}>
              {p.name}
              {snap.settings.wordSource === "players" && (
                <span className="chip-count">
                  {p.wordCount}/{snap.settings.wordsPerPlayer}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {snap.settings.wordSource === "players" ? (
        <MyWords snap={snap} send={send} />
      ) : host ? (
        <HostWordList count={snap.hostWordCount} send={send} />
      ) : (
        <p className="muted">The host is choosing the words for this game.</p>
      )}

      {host ? <Settings settings={snap.settings} send={send} inLobby /> : <RulesSummary snap={snap} />}

      <div className="grow" />
      <footer className="actions">
        {host ? (
          <>
            {blocker && <p className="muted center">{blocker}</p>}
            <button type="button" className="btn btn-paper" disabled={Boolean(blocker)} onClick={() => send({ type: "makeTeams" })}>
              Make teams
            </button>
          </>
        ) : (
          <p className="muted center">Waiting for the host to make teams</p>
        )}
      </footer>
    </main>
  )
}

function Invite({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <section className="invite sheet" aria-label="Invite">
      <QrCode text={url} size={200} />
      <p>Scan to join</p>
      <button
        type="button"
        className="btn btn-small btn-ink"
        onClick={async () => {
          try {
            if (navigator.share) await navigator.share({ title: "Join my Saladbowl game", url })
            else {
              await navigator.clipboard.writeText(url)
              setCopied(true)
            }
          } catch {
            /* share sheet dismissed */
          }
        }}
      >
        {copied ? "Link copied" : "Share link"}
      </button>
    </section>
  )
}

function MyWords({ snap, send }: { snap: Snapshot; send: Send }) {
  const [word, setWord] = useState("")
  const max = snap.settings.wordsPerPlayer
  const letter = snap.settings.startingLetter
  const full = snap.myWords.length >= max
  // Clear the box only once the word shows up in your list; a rejected word (duplicate, wrong letter) stays to fix.
  const count = useRef(snap.myWords.length)
  useEffect(() => {
    if (snap.myWords.length > count.current) setWord("")
    count.current = snap.myWords.length
  }, [snap.myWords.length])
  const add = () => {
    const w = word.trim()
    if (!w || full) return
    send({ type: "addWord", word: w })
  }
  return (
    <section aria-label="Your words" className="words">
      <h2 className="section-title">Your words</h2>
      <p className="muted">
        {full
          ? `All ${max} words in. Nice.`
          : `Add ${max - snap.myWords.length} more. People, places, films, anything. Others won't see them.`}
      </p>
      {letter && <p className="muted">Words must start with {letter}</p>}
      <form
        className="word-form"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input
          aria-label="Add a word"
          name="word"
          className="input"
          value={word}
          maxLength={40}
          disabled={full}
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="done"
          placeholder={letter ? `Something with ${letter}` : "Shah Rukh Khan"}
          onChange={(e) => setWord(e.target.value)}
        />
        <button type="submit" className="btn btn-paper btn-add" disabled={full || !word.trim()}>
          Add
        </button>
      </form>
      <ul className="slips">
        {snap.myWords.map((w) => (
          <li key={w.id} className="slip-small">
            <span>{w.word}</span>
            <button type="button" className="btn-icon" aria-label={`Remove ${w.word}`} onClick={() => send({ type: "removeWord", cardId: w.id })}>
              <Icon name="close" size={18} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function HostWordList({ count, send }: { count: number; send: Send }) {
  const [text, setText] = useState("")
  return (
    <section aria-label="Word list" className="words">
      <h2 className="section-title">Word list</h2>
      <p className="muted">{count ? `${count} words in the bowl.` : "Paste words, one per line or separated by commas."}</p>
      <textarea
        aria-label="Words for the bowl"
        name="words"
        className="input textarea"
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        type="button"
        className="btn btn-paper"
        disabled={!text.trim()}
        onClick={() => {
          const words = text
            .split(/[\n,]/)
            .map((w) => w.trim().slice(0, 40))
            .filter(Boolean)
            .slice(0, 300)
          if (send({ type: "setHostWordList", words })) setText("")
        }}
      >
        Put these in the bowl
      </button>
    </section>
  )
}

function RulesSummary({ snap }: { snap: Snapshot }) {
  const s = snap.settings
  return (
    <section className="muted rules-summary" aria-label="Rules">
      <p>
        {s.secondsPerTurn} seconds a turn, {s.rounds.length} {s.rounds.length === 1 ? "round" : "rounds"}
        {s.allowSkips ? ", skips allowed." : ", no skips."}
      </p>
    </section>
  )
}
