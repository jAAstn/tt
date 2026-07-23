# MarvellousSuspender – Domain-spezifische Suspend-Zeiten

## Was wurde geändert?

Diese Mod fügt die Möglichkeit hinzu, für einzelne Domains eigene Suspend-Zeiten festzulegen,
die die globale Einstellung überschreiben.

### Geänderte Dateien

| Datei | Beschreibung |
|-------|-------------|
| `js/gsStorage.js` | Neuer Setting-Key `DOMAIN_SUSPEND_TIMES`, Parser-Funktion, URL-Matcher |
| `js/tgs.js` | `resetAutoSuspendTimerForTab` prüft jetzt Domain-Regeln vor der globalen Zeit |
| `js/options.js` | Neues Formularfeld + Live-Vorschau der geparseten Regeln |
| `options.html` | Neuer UI-Bereich "Domain-spezifische Suspend-Zeiten" |

---

## Installation

1. Öffne den Extensions-Ordner der Erweiterung (z. B. aus `chrome://extensions/` → „Details" → Pfad kopieren).
2. Ersetze die folgenden Dateien durch die modifizierten Versionen aus diesem Paket:
   - `js/gsStorage.js`
   - `js/tgs.js`
   - `js/options.js`
   - `options.html`
3. Lade die Erweiterung in `chrome://extensions/` neu (🔄-Symbol beim Eintrag).

---

## Benutzung

In den Einstellungen (`options.html`) gibt es jetzt den Abschnitt
**"Domain-spezifische Suspend-Zeiten"** unterhalb der Whitelist.

### Format

```
# Kommentar (wird ignoriert)
domain.com=MINUTEN
```

- Eine Regel pro Zeile
- `MINUTEN` kann jeder positive Dezimalwert sein (z. B. `0.33` für 20 Sekunden)
- `0` = niemals suspendieren (nur für diese Domain)
- Subdomains werden automatisch gematcht: `example.com` gilt auch für `sub.example.com`

### Beispiele

```
# Erwachsenenunterhaltung – kurz
rule34.xxx=3
eporner.com=5

# Arbeit – lang oder nie
github.com=120
jira.mycompany.com=0

# Standard bleibt unberührt
```

### Priorität

1. **Domain-Regel** (wenn vorhanden) → überschreibt alles
2. **Globale Einstellung** (Fallback)

Die Whitelist (= niemals suspendieren, unabhängig von Zeit) hat weiterhin höchste Priorität.

---

## Hinweise

- Änderungen werden sofort gespeichert; offene Tabs bekommen beim nächsten Timer-Reset
  (z. B. beim Wechsel des Fokus) die neue Zeit.
- Die Live-Vorschau unter dem Textfeld zeigt an, welche Regeln gerade aktiv sind.
- Ungültige Zeilen (kein `=`, keine Zahl, …) werden stillschweigend ignoriert.
