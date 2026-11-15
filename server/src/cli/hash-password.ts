import { stdin, stdout } from "node:process"
import { hashPassword } from "../auth/password.js"

/** Reads a line from the TTY without echoing it. */
function ask(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    stdout.write(prompt)
    let buf = ""
    const tty = stdin.isTTY
    if (tty) stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding("utf8")
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") {
          stdin.off("data", onData)
          if (tty) stdin.setRawMode(false)
          stdin.pause()
          stdout.write("\n")
          return resolve(buf)
        }
        if (c === "\u0003") process.exit(130)
        if (c === "\u007f") buf = buf.slice(0, -1)
        else buf += c
      }
    }
    stdin.on("data", onData)
  })
}

const a = await ask("New host password: ")
const b = await ask("Again: ")
if (a !== b) {
  console.error("Passwords don't match.")
  process.exit(1)
}
if (a.length < 10) {
  console.error("Use at least 10 characters.")
  process.exit(1)
}
console.log("\nSet this as SALADBOWL_PASSWORD_HASH:\n")
console.log(await hashPassword(a))
