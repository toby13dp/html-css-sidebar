# HTML-CSS Sidebar for Phoenix Code

Context-gevoelige CSS-zijbalk voor [Phoenix Code](https://phcode.dev) / Brackets-extensions:

- zet je cursor op een **HTML-tag**, **class** of **id**
- de extensie zoekt alle bijbehorende CSS-regels in je project
- toont ze in een vaste, resizable **rechterzijbalk**
- je kunt de regels daar direct bewerken; bij `blur` wordt de wijziging teruggeschreven naar het originele bestand

> Gemaakt bovenop de Phoenix/Brackets-API’s `HTMLUtils` en `CSSUtils.findMatchingRules()`.

---

## Features

- 🔍 **Context-aware**  
  Detecteert op basis van de cursor:
  - `div` → alle `div`-selectors  
  - `class="btn primary"` → `.btn` of `.primary` (op basis van cursorpositie)  
  - `id="main"` → `#main`

- 📂 **Zoekt door je hele project**
  - alle `.css`, `.less`, `.scss` bestanden
  - inline `<style>`-blokken in het huidige HTML-bestand

- 📑 **Groepering per bestand**
  - CSS-regels gegroepeerd per file
  - inklapbare groepen
  - teller met “X regels in Y bestanden”

- 🎚️ **Bestandsfilter**
  - dropdown om:
    - alle bestanden
    - of één specifiek bestand te tonen

- ✏️ **Inline editing met diff-accent**
  - elke CSS-regel in een eigen `<textarea>`
  - tijdens typen: geel “gewijzigd” accent
  - bij `blur`: schrijft terug naar de originele regels + kort groen “saved” accent

- 🧱 **Vaste rechterzijbalk**
  - resizable via de Phoenix Resizer-API
  - schuift de editorinhoud automatisch naar links
  - header met titel + sluit-knop (×)
  - togglen via menu: `View → HTML-CSS Sidebar`