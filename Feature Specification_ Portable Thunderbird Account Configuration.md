# Portable Thunderbird Account Configuration

## Ziel

Entwickle ein Thunderbird-WebExtension-Add-on, mit dem Benutzer ihre **Mail-Kontenkonfiguration plattformunabhängig exportieren und auf einem anderen Thunderbird-System wieder importieren** können.

Der primäre Anwendungsfall ist:

```text
Windows Thunderbird
        ↓
   Export-Datei
        ↓
Linux Thunderbird
```

Das Add-on darf **nicht** von Betriebssystem-spezifischen Profilpfaden oder einer direkten Kopie des Thunderbird-Profils abhängig sein.

Der Export soll ausschließlich die **semantische Kontenkonfiguration** enthalten.

---

# 1. Hauptfunktionen

Das Add-on muss zwei Hauptfunktionen bereitstellen:

1. **Kontenkonfiguration exportieren**
2. **Kontenkonfiguration importieren**

Die Funktionen sollen über eine gut erreichbare UI verfügbar sein, z. B. über die Add-on-Einstellungen, eine Toolbar-Schaltfläche oder das Thunderbird-Menü.

Bevor eine Implementierung begonnen wird, soll der Agent die aktuell verfügbare Thunderbird-WebExtension-API prüfen.

Die `accounts` API kann Konten und Identitäten lesen und stellt unter anderem `messenger.accounts.list()` und `messenger.accounts.get()` bereit. Sie benötigt `accountsRead`.

Falls benötigte Informationen nicht über die reguläre WebExtension-API verfügbar sind, soll geprüft werden, ob ein **WebExtension Experiment** erforderlich ist.

Thunderbird stellt WebExtension Experiments ausdrücklich als Mechanismus bereit, um APIs bereitzustellen, die von den normalen WebExtension-APIs noch nicht abgedeckt werden.

---

# 2. Grundprinzip

Das Exportformat muss **plattformunabhängig** sein.

Nicht exportieren:

- Windows-Pfade
- Linux-Pfade
- Thunderbird-Profilpfade
- interne Profilverzeichnisnamen
- Cache-Daten
- lokale UI-Zustände
- zufällige/interne Thunderbird-IDs, sofern sie nicht für die Wiederherstellung benötigt werden

Stattdessen sollen fachliche Eigenschaften exportiert werden.

Beispiel:

```json
{
  "format": "thunderbird-portable-account-config",
  "version": 1,
  "exportedAt": "2026-08-19T12:00:00Z",
  "accounts": []
}
```

Das Format muss versioniert sein.

Der Importer muss anhand der `version` erkennen können, wie die Datei verarbeitet werden muss.

---

# 3. Zu exportierende Daten

Für jedes unterstützte Mailkonto sollen möglichst folgende Informationen exportiert werden.

## Account

- Anzeigename
- Account-Typ
- Incoming-Server-Konfiguration
- zugehörige Identitäten
- Standard-Identity

Unterstützte native Account-Typen sollen mindestens berücksichtigt werden:

- IMAP
- POP3
- EWS
- NNTP
- RSS, sofern sinnvoll
- Local Folders nur dann, wenn eine sinnvolle plattformunabhängige Migration möglich ist

Die Thunderbird-API kennt unter anderem `imap`, `pop3`, `ews`, `nntp`, `rss` und `none` als Account-Typen.

Nicht unterstützte Typen müssen beim Export eindeutig als solche gekennzeichnet werden.

---

# 4. Incoming Server

Für den Incoming Server sollen, soweit über die Thunderbird-API verfügbar, mindestens folgende Werte exportiert werden:

```text
type
hostname
port
username
authentication method
TLS / socket type
```

Weitere relevante Servereinstellungen sollen berücksichtigt werden, wenn sie für die Wiederherstellung des Kontos notwendig sind.

Keine Passwörter exportieren.

---

# 5. Identities

Für jede Identity sollen möglichst folgende Daten exportiert werden:

```text
full name
email address
reply-to
organization
signature
signature format
default identity
SMTP server reference
```

Mehrere Identitäten pro Account müssen unterstützt werden.

Die Thunderbird-`accounts` API liefert Accounts einschließlich ihrer zugeordneten Identitäten.

---

# 6. SMTP

SMTP-Konfiguration muss separat modelliert werden.

Beispiel:

```json
{
  "smtpServers": [
    {
      "id": "smtp-1",
      "hostname": "smtp.example.com",
      "port": 465,
      "username": "user@example.com",
      "authentication": "...",
      "security": "ssl"
    }
  ]
}
```

Identitäten referenzieren SMTP-Konfigurationen über eine stabile Export-ID.

Nicht einfach dieselben SMTP-Daten mehrfach in jede Identity kopieren.

---

# 7. Passwörter

Passwörter dürfen in Version 1 **nicht exportiert werden**.

Das Exportformat darf keine Klartext-Passwörter enthalten.

Auch verschlüsselte Passwörter sollen zunächst nicht Bestandteil des Formats sein.

Beim Import soll Thunderbird das Passwort bei Bedarf über seinen normalen Passwort-/Authentifizierungsmechanismus anfordern.

OAuth-/Token-Daten sollen ebenfalls nicht exportiert werden.

Falls ein Konto OAuth verwendet, soll die Konfiguration importiert werden und Thunderbird soll den normalen OAuth-Anmeldeprozess durchführen.

---

# 8. Import

Beim Import muss die vorhandene Thunderbird-Konfiguration geprüft werden.

**Es darf nicht einfach jedes importierte Konto blind neu angelegt werden.**

Für jedes importierte Konto muss geprüft werden, ob ein entsprechendes Konto bereits existiert.

---

# 9. Erkennung bereits vorhandener Konten

Die Erkennung soll nicht ausschließlich über den Account-Namen erfolgen.

Ein Konto soll anhand möglichst stabiler fachlicher Merkmale identifiziert werden.

Primäre Kriterien:

1. Account-Typ
2. E-Mail-Adresse einer Identity
3. Incoming-Server-Hostname
4. Incoming-Server-Benutzername

Beispiel:

```text
type      = imap
email     = max@example.com
hostname  = imap.example.com
username  = max@example.com
```

Wenn diese Werte mit einem bestehenden Konto ausreichend übereinstimmen, soll das Konto als bereits vorhanden erkannt werden.

Account-Namen allein dürfen **niemals** als eindeutiger Schlüssel verwendet werden.

---

# 10. Verhalten bei bereits vorhandenem Konto

Wenn ein Konto bereits vorhanden ist, darf es nicht automatisch überschrieben werden.

Der Benutzer muss eine Entscheidung treffen können.

Beispiel UI:

```text
Das folgende Konto existiert bereits:

Max Mustermann <max@example.com>
IMAP: imap.example.com

[Überspringen]
[Konfiguration aktualisieren]
[Als neues Konto importieren]
```

Standardmäßig soll **Überspringen** ausgewählt sein.

---

# 11. Verhalten bei mehreren Konflikten

Beim Import können unterschiedliche Situationen auftreten.

## Fall A: Konto existiert nicht

```text
→ Konto anlegen
```

## Fall B: Konto existiert identisch

```text
→ als bereits vorhanden markieren
→ standardmäßig überspringen
```

## Fall C: Konto existiert, Konfiguration unterscheidet sich

```text
→ Benutzer fragen
```

UI soll beispielsweise zeigen:

```text
Konto: max@example.com

Unterschiede:

                 Vorhanden             Import
--------------------------------------------------
IMAP Host        imap.old.de            imap.new.de
IMAP Port        993                    993
TLS              SSL                    SSL
Username         max@example.com        max@example.com

[Überspringen]
[Import-Konfiguration übernehmen]
[Als neues Konto importieren]
```

---

# 12. Import-Vorschau

Vor dem eigentlichen Import soll eine Zusammenfassung angezeigt werden.

Beispiel:

```text
Importprüfung

20 Konten in Datei gefunden

15 neue Konten
3 bereits vorhanden
2 mit abweichender Konfiguration

[Zurück]
[Import starten]
```

Für jedes Konto soll der Status sichtbar sein:

```text
✓ Neues Konto
= Bereits vorhanden
! Konfigurationskonflikt
✕ Nicht unterstützt
```

---

# 13. Import als Transaktion

Der Import soll möglichst sicher erfolgen.

Wenn mehrere Konten importiert werden und ein einzelner Import fehlschlägt:

- bereits erfolgreich angelegte Konten nicht beschädigen
- Fehler protokollieren
- weitere unabhängige Konten nach Möglichkeit weiter importieren

Nach Abschluss soll ein Ergebnisbericht angezeigt werden.

Beispiel:

```text
Import abgeschlossen

17 Konten importiert
2 Konten übersprungen
1 Konto konnte nicht importiert werden

Details anzeigen
```

---

# 14. Fehlerbehandlung

Fehler müssen für Benutzer verständlich dargestellt werden.

Nicht nur:

```text
Error: NS_ERROR_FAILURE
```

sondern beispielsweise:

```text
Das Konto max@example.com konnte nicht angelegt werden.

Thunderbird unterstützt diesen Kontotyp über die aktuelle
Add-on-API nicht.

Technische Details:
...
```

Technische Details dürfen optional aufklappbar sein.

---

# 15. Export-Dateiformat

Die Exportdatei soll JSON verwenden.

Dateiendung:

```text
.tbaccount
```

Beispiel:

```json
{
  "format": "thunderbird-portable-account-config",
  "version": 1,
  "exportedAt": "2026-08-19T12:00:00Z",
  "accounts": [
    {
      "name": "Firma",
      "type": "imap",

      "incoming": {
        "hostname": "imap.example.com",
        "port": 993,
        "username": "max@example.com",
        "security": "ssl",
        "authentication": "password"
      },

      "identities": [
        {
          "fullName": "Max Mustermann",
          "email": "max@example.com",
          "replyTo": "",
          "organization": "",
          "signature": "",
          "signatureFormat": "plain",
          "default": true,
          "smtpServer": "smtp-1"
        }
      ]
    }
  ],

  "smtpServers": [
    {
      "id": "smtp-1",
      "hostname": "smtp.example.com",
      "port": 465,
      "username": "max@example.com",
      "security": "ssl",
      "authentication": "password"
    }
  ]
}
```

Das Format soll als eigene TypeScript-Typen bzw. JSON-Schema modelliert werden.

---

# 16. Sicherheit

Besonders sorgfältig mit folgenden Informationen umgehen:

- E-Mail-Adressen
- Benutzernamen
- Servernamen
- OAuth-Konfiguration
- Signaturen

Passwörter und Tokens dürfen niemals exportiert werden.

Beim Import darf eine Datei nicht automatisch ausgeführt werden.

Die Datei enthält ausschließlich Daten.

---

# 17. Plattformunabhängigkeit

Das Add-on muss mindestens funktionieren auf:

- Windows
- Linux
- macOS

Es darf keine Annahmen über folgende Pfade enthalten:

```text
C:\Users\...
%APPDATA%
/home/...
~/.thunderbird/...
```

Es dürfen keine direkten Manipulationen an `prefs.js` oder anderen Thunderbird-Profil-Dateien erforderlich sein.

Wenn eine interne Thunderbird-API benötigt wird, soll diese über die entsprechende WebExtension-API bzw. ein Experiment abstrahiert werden.

---

# 18. API-Strategie

Zuerst die offiziellen Thunderbird-WebExtension-APIs verwenden.

Insbesondere:

```text
messenger.accounts
```

Die `accounts` API bietet bereits Zugriff auf Konten, Identitäten und Konteninformationen.

Falls eine benötigte Funktion fehlt:

1. prüfen, ob eine andere offizielle API sie bereitstellt
2. prüfen, ob Thunderbird bereits ein passendes WebExtension Experiment bereitstellt
3. erst danach ein eigenes Experiment implementieren

Thunderbird beschreibt Experiments ausdrücklich als Möglichkeit, fehlende APIs bereitzustellen.

Ein eigenes Experiment muss möglichst klein bleiben.

---

# 19. Manifest

Modernes Thunderbird-WebExtension-Format verwenden.

Nicht auf veraltete Legacy-XUL-Add-ons setzen.

Die aktuelle Thunderbird-Dokumentation unterscheidet Manifest V2 und V3. Der Agent soll die zum Zeitpunkt der Implementierung empfohlene Variante verwenden und die Kompatibilität dokumentieren.

Benötigte Permissions sollen auf das absolut notwendige Minimum beschränkt werden.

---

# 20. UI

Die Benutzeroberfläche soll schlicht und funktional sein.

Keine unnötige Komplexität.

Benötigte Ansichten:

### Export

```text
Kontenkonfiguration exportieren

☑ Konto 1
☑ Konto 2
☑ Konto 3
...

[Alle auswählen]
[Alle abwählen]

[Exportieren]
```

Der Benutzer soll optional einzelne Konten auswählen können.

### Import

```text
Kontenkonfiguration importieren

[Datei auswählen]

20 Konten gefunden

15 neu
3 vorhanden
2 Konflikte

[Import prüfen]
```

Danach die Konflikt-/Vorschauansicht.

---

# 21. Internationalisierung

UI-Texte nicht hart in JavaScript/HTML einbauen.

Mindestens vorbereiten für:

```text
de
en
```

Deutsch darf zunächst die Standardsprache sein.

---

# 22. Tests

Es müssen automatisierte Tests erstellt werden.

Mindestens:

## Export

- ein IMAP-Konto exportieren
- mehrere Konten exportieren
- mehrere Identitäten exportieren
- SMTP-Verknüpfungen prüfen
- keine Passwörter im Export
- gültiges JSON
- korrekte Versionsnummer

## Import

- neues Konto importieren
- vorhandenes Konto erkennen
- vorhandenes identisches Konto überspringen
- abweichendes Konto erkennen
- Konto als neues Konto importieren
- mehrere Konten importieren
- ungültige Datei ablehnen
- unbekannte Formatversion ablehnen
- nicht unterstützten Account-Typ behandeln

## Round Trip

Ein besonders wichtiger Test:

```text
Thunderbird A
    ↓
Export
    ↓
JSON
    ↓
Import
    ↓
Thunderbird B
```

Danach müssen die relevanten Konteneigenschaften übereinstimmen.

---

# 23. Round-Trip-Invariante

Für alle exportierbaren Eigenschaften soll gelten:

```text
export(import(export(account))) ≈ export(account)
```

Dabei dürfen sich interne Thunderbird-IDs unterscheiden.

Beispielsweise:

```text
accountId
serverKey
smtpServerKey
```

müssen nicht identisch sein.

Die semantischen Eigenschaften müssen jedoch identisch sein.

---

# 24. Dokumentation

Erstelle eine README.md mit:

- Zweck
- Installation
- unterstützte Thunderbird-Versionen
- unterstützte Account-Typen
- Exportformat
- Sicherheitsmodell
- bekannte Einschränkungen
- Entwicklung
- Tests
- Build
- Installation eines Development-Builds

Zusätzlich soll das JSON-Format dokumentiert werden.

---

# 25. Entwicklungsstrategie

Nicht sofort eine große Implementierung schreiben.

Arbeite in folgenden Phasen:

## Phase 1: API-Analyse

Untersuche:

- aktuelle Thunderbird-WebExtension-API
- `accounts`
- Identitäten
- SMTP-Zugriff
- Account-Erstellung
- bestehende WebExtension Experiments

Dokumentiere, welche Informationen direkt verfügbar sind und welche nicht.

## Phase 2: Minimaler Prototyp

Implementiere:

```text
Accounts lesen
        ↓
JSON exportieren
```

Noch kein Import.

## Phase 3: Import

Implementiere:

```text
JSON
 ↓
Validierung
 ↓
bestehende Accounts suchen
 ↓
Konflikte erkennen
 ↓
Benutzerentscheidung
 ↓
Account anlegen
```

## Phase 4: UI

Vorschau und Konfliktauflösung hinzufügen.

## Phase 5: Tests

Automatisierte Tests und Round-Trip-Tests.

## Phase 6: Packaging

Installierbares Thunderbird-Add-on erstellen.

---

# 26. Wichtige technische Regel

**Nicht versuchen, `prefs.js` zu parsen oder zu manipulieren, solange es eine bessere API-basierte Lösung gibt.**

Die interne Thunderbird-Datenstruktur darf nicht zum öffentlichen Exportformat werden.

Das Add-on soll eine eigene stabile Abstraktion zwischen Thunderbird-internem Modell und portablem Exportformat besitzen:

```text
Thunderbird API
      ↓
Account Adapter
      ↓
Portable Model
      ↓
JSON Serializer
```

und beim Import:

```text
JSON
 ↓
Schema Validator
 ↓
Portable Model
 ↓
Account Adapter
 ↓
Thunderbird API
```

---

# 27. Erwartetes Ergebnis

Am Ende soll ein Benutzer unter Windows:

```text
Thunderbird
 → Portable Account Configuration
 → Export
 → backup.tbaccount
```

und anschließend unter Linux:

```text
Thunderbird
 → Portable Account Configuration
 → Import
 → backup.tbaccount
```

ausführen können.

Bei beispielsweise 20 Konten soll Thunderbird anschließend alle nicht vorhandenen Konten automatisch anlegen können.

Bereits vorhandene Konten dürfen nicht ungefragt überschrieben werden.

Der Benutzer soll bei Konflikten ausdrücklich entscheiden können.

Das Add-on soll vollständig ohne Betriebssystem-spezifische Profilkopien funktionieren.

---

# 28. Definition of Done

Das Feature gilt als fertig, wenn:

- [ ] Konten exportiert werden können
- [ ] mehrere Konten gleichzeitig exportiert werden können
- [ ] IMAP mindestens vollständig unterstützt wird
- [ ] POP3 mindestens vollständig unterstützt wird, sofern die API dies ermöglicht
- [ ] EWS untersucht und entweder unterstützt oder sauber als nicht unterstützt gekennzeichnet wird
- [ ] Identitäten exportiert werden
- [ ] SMTP-Konfiguration exportiert wird
- [ ] Passwörter nicht exportiert werden
- [ ] Exportformat versioniert ist
- [ ] JSON-Schema vorhanden ist
- [ ] Import funktioniert
- [ ] bestehende Konten erkannt werden
- [ ] Account-Namen nicht als alleiniger Duplikat-Schlüssel verwendet werden
- [ ] Konflikte angezeigt werden
- [ ] vorhandene Konten nicht ungefragt überschrieben werden
- [ ] Benutzer zwischen Überspringen, Aktualisieren und Neu-Anlegen wählen kann
- [ ] Windows → Linux getestet wurde
- [ ] Linux → Windows getestet wurde
- [ ] Round-Trip-Tests vorhanden sind
- [ ] automatisierte Tests vorhanden sind
- [ ] README vorhanden ist
- [ ] bekannte Einschränkungen dokumentiert sind
- [ ] keine Betriebssystem-spezifischen Profilpfade benötigt werden
- [ ] keine direkte Manipulation von `prefs.js` erforderlich ist

---

# 29. Wichtig für den Coding-Agenten

Vor dem Schreiben größerer Mengen Code:

1. Repository-Struktur analysieren.
2. Aktuelle Thunderbird-API-Dokumentation prüfen.
3. Vorhandene Beispiele und WebExtension-Experiments untersuchen.
4. Prüfen, ob Account-Erstellung und SMTP-Zugriff über offizielle APIs möglich sind.
5. Erst danach Architektur festlegen.

Keine APIs erfinden.

Wenn eine API nicht vorhanden ist, soll dies im Code/README dokumentiert und eine möglichst kleine Abstraktionsschicht bzw. ein WebExtension Experiment verwendet werden.

Bei Unsicherheit über die API-Kompatibilität lieber einen kleinen funktionierenden Prototypen bauen und testen, bevor die gesamte Anwendung darauf aufgebaut wird.

**Ziel ist ein tatsächlich installierbares Thunderbird-Add-on, nicht nur ein Mockup oder eine theoretische Implementierung.**

---

# 30. Änderungen seit Erstfassung (Changelog / Addendum)

Dieser Abschnitt wurde nachträglich ergänzt und dokumentiert alle Entscheidungen und Erweiterungen, die seit dem ersten Einlesen dieser Spezifikation getroffen bzw. umgesetzt wurden. Die Abschnitte 1–29 oben bleiben als ursprüngliche Anforderung unverändert; Punkte hier präzisieren oder erweitern sie.

## 30.1 Getroffene Grundentscheidungen (Phase 0)

Vor Implementierungsbeginn wurden folgende offene Punkte mit dem Nutzer geklärt:

| Thema | Entscheidung |
|---|---|
| Ziel-Thunderbird-Version | **TB 128 ESR+** (getestet aktuell bis TB 153 ESR) |
| Manifest | **Manifest V3** |
| Fehlende APIs | **WebExtension Experiment** akzeptiert, so klein wie möglich |
| EWS/OAuth | **Konfiguration exportieren**, OAuth-Login findet nach Import in Thunderbird statt |
| Signaturen | **Inhalt einbetten** (kein Datei-Pfad, kein `sig_file`) |
| Duplikat-Matching | **Normalisiert**: `trim` + `toLowerCase` für E-Mail / Hostname / Username |

## 30.2 Erweiterungen des Datenmodells

Ergänzend zu §15:

- Feld `authentication` übernimmt Werte wie `"password"`, `"oauth2"`, `"gssapi"` 1:1; Tokens werden nie exportiert.
- EWS-Konten: eigener `type: "ews"`, optional `ewsUrl` im `incoming`-Block.
- Signatur: immer als eingebetteter Text (`signature` + `signatureFormat`), niemals als Datei-Pfad. Beim Export wird bei `sig_file` der Inhalt via Experiment gelesen.
- Nicht unterstützte Konten werden beim Import als `unsupported` markiert statt still verworfen.

## 30.3 Normalisierungs-Regel (Ergänzung zu §9)

Ein Konto gilt als Duplikat, wenn alle vier normalisierten Felder gleich sind:

```ts
const norm = (s: string) => s.trim().toLowerCase();
matchKey = {
  type: a.type,                       // exakt
  email: norm(identity.email),
  hostname: norm(incoming.hostname),
  username: norm(incoming.username),
};
```

## 30.4 Umgesetzte Architektur

Die in §26 skizzierte Abstraktion ist real vorhanden:

- `src/adapter/thunderbird.ts` — Interface (Seam).
- `src/adapter/webext.ts` — echte `messenger.accounts` + Experiment-Aufrufe.
- `src/adapter/memory.ts` — In-Memory-Fake für Tests.
- `src/model/portable.ts` + `schema/*.schema.json` — Portable Model.
- `src/core/export.ts` / `src/core/import.ts` — Ex-/Import inkl. Plan (new / identical / conflict / unsupported), Feld-Diff und per-Item-transaktionaler Ausführung gemäß §13.
- `src/io/validate.ts` — Struktur-Validierung (handgeschrieben, ohne Ajv-Bare-Specifier im Runtime-Bundle; Ajv nur in Tests).

## 30.5 WebExtension Experiment (§18) — konkretisiert

Das Experiment (`src/experiment/`) bleibt bewusst minimal und deckt genau die von der offiziellen API nicht abgedeckten Punkte ab:

- `listSmtpServers()` — Enumeration der SMTP-Server über `MailServices.outgoingServer` / `MailServices.smtp` mit Fallbacks (Iterator / `enumerate()` / indexbasiert).
- `getIncomingServer(accountKey)` — liest `hostname/port/username/socketType/authMethod/ewsUrl`, weil `messenger.accounts.list()` in TB 128+ diese Felder teilweise nicht liefert.
- `readSignatureFile(path)` — liest Signatur-Datei-Inhalt für den Export.
- `createAccount(portableAccount)` / `updateAccount(...)` — XPCOM-basiertes Anlegen/Aktualisieren via `MailServices.accounts`; mappt `security→socketType`, `authentication→authMethod` inkl. OAuth2/gssapi, findet oder erzeugt SMTP-Server per Match auf hostname/port/username.
- `readWatchedFile(path)` — liest beobachtete Datei mit `IOUtils.stat`/`read`, 4 MiB-Limit, SHA-256 via WebCrypto.

## 30.6 UI-Anpassungen

- Popup als MV3-`action` (nicht `browser_action`).
- **Import läuft in einem eigenen Tab** (`ui/import.html`), nicht im Popup — der OS-File-Picker schließt sonst das Popup, bevor `change` feuert.
- Neue **Settings-Seite** (`ui/settings.html`) mit Onboarding beim ersten Popup-Öffnen.
- i18n: `de` (default) + `en`.

## 30.7 Neue Funktion: Watch + Notification (nicht in Erstfassung)

Erweiterung über §1 hinaus — beobachtet eine Datei in einem synchronisierten Ordner (z. B. Nextcloud):

- Poll via `browser.alarms` (Standard 15 min).
- Änderungserkennung per SHA-256 in `storage.local`.
- Bei `plan.summary.new + conflict > 0` → System-`notifications.create`; Klick öffnet `import.html?source=watched` mit vorbefüllter Datei.
- **Optionaler Auto-Import** ausschließlich für konfliktfreie `new`-Items. Konflikte bleiben immer manuell (§10).
- **Auto-Export-Skelett** (Listener auf `accounts.onCreated/onUpdated/onDeleted`, debounced) hinter Setting-Toggle vorhanden; der schreibende Teil (`writeWatchedFile` im Experiment mit atomischem Rename) ist noch offen.
- Zusätzliche Permissions: `alarms`, `notifications`, `tabs`.

## 30.8 Packaging / Distribution (Ergänzung zu Phase 6)

- Build: `npm run package` → `web-ext-artifacts/portable_kontenkonfiguration-<version>.xpi`.
- **ATN-Anforderung**: Mail Experiments erfordern zwingend `strict_max_version`. Manifest enthält daher `strict_min_version: "128.0"`, `strict_max_version: "153.*"`. Die vom Firefox-Linter dazu ausgegebene generische Warnung ist erwartet und kann ignoriert werden.
- Signierung erfolgt über ATN (unlisted oder listed).
- Update-Kanal: `browser_specific_settings.gecko.update_url` verweist auf `https://wolxxx.de/tbaccsync/updates.json` (für self-hosted signierte Builds; bei ATN-listed wird das Feld ignoriert).

## 30.9 Metadaten

- Extension-ID: `tbaccsync@wolxxx.de` (geändert von ursprünglichem Platzhalter `portable-account-config@example.org` — Bruch der Update-Kette wurde bewusst akzeptiert).
- Autor: `wolxXx`, Kontakt: `tbaccsync@wolxxx.de`.
- Homepage: `https://wolxxx.de/projects/tbaccsync`.
- Aktuelle Version: **0.4.0**.

## 30.10 Erweiterung von §7 (Passwörter/OAuth)

Klarstellung nach Umsetzung: Auch **automatisch** über den Watcher importierte Konten fordern beim ersten Verbindungsaufbau interaktiv Passwort bzw. OAuth-Login an — das Add-on schreibt nie Credentials.

## 30.11 Bewusst offene Punkte

- Auto-Export ist als Skelett vorhanden, aber nicht Ende-zu-Ende — `writeWatchedFile` (atomischer Rename via `IOUtils.write`) ist noch nicht implementiert.
- Zwei-Wege-Sync (Race Conditions mit Nextcloud-Sync) ist ausdrücklich nicht in v1.
- Für neue TB-ESR-Linien (156, 159, …) muss `strict_max_version` gebumpt werden — gewollter Workflow bei Mail Experiments.