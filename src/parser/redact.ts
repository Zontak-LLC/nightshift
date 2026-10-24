/**
 * Night Shift shows commands, searches and replies on a screen, maybe a shared one. Anything that looks like a secret is
 * hidden before it is shown: key=value pairs whose name sounds secret, bearer tokens, known key formats, long random
 * strings, and the query string of a URL.
 */
const SECRET_NAME =
  /\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|CREDENTIAL)[A-Z0-9_]*)=("[^"]*"|'[^']*'|\S+)/gi;
const BEARER = /\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const KNOWN =
  /\b(sk-ant-[\w-]+|sk-[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[abpr]-[\w-]+|eyJ[\w-]+\.[\w-]+\.[\w-]+)/g;
const LONG_RANDOM = /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g;
const URL_QUERY = /(https?:\/\/[^\s?#"']+)[?#][^\s"']*/g;

export function redact(text: string): string {
  return text
    .replace(URL_QUERY, "$1?…")
    .replace(SECRET_NAME, "$1=•••")
    .replace(BEARER, "$1 •••")
    .replace(KNOWN, "•••")
    .replace(LONG_RANDOM, "•••");
}
