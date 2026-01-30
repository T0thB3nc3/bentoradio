# 📻 Bento Radio – Discord Rádió & YouTube Bot

**Bento Radio** egy modern, nagy teljesítményű Discord bot, amely online rádióállomások és YouTube videók hanganyagának streamelésére alkalmas. A bot a legfrissebb technológiákat használja a stabil és kristálytiszta hangzás érdekében.

---

## 🚀 Újdonságok a v2.0-ban
* **Modern Audio Engine:** Átállás `prism-media` alapú FFmpeg dekódolásra (nincs szükség natív C++ fordítóra).
* **YouTube Támogatás:** Közvetlen lejátszás YouTube linkekről a `/play` paranccsal.
* **Dinamikus Csatorna Státusz:** A bot automatikusan frissíti a hangcsatorna állapotát (Voice Status) a játszott adó nevére.
* **Node.js v24+ Kompatibilitás:** Teljes támogatás a legújabb futtatókörnyezetekhez.

---

## ⚙️ Előkészületek

1. **Node.js** telepítése (ajánlott: `22.12.0` vagy újabb).
2. **FFmpeg** megléte (a bot az `ffmpeg-static` csomagot használja, így külön telepítést nem igényel).
3. `.env` fájl konfigurálása:
    ```env
    TOKEN=your-bot-token
    ```

4. Függőségek telepítése:
    ```bash
    npm install
    ```

5. Bot indítása (fejlesztői mód):
    ```bash
    node index.js
    ```
   *(Éles üzemben ajánlott a **PM2** használata: `pm2 start index.js --name bento_radio`)*

---

## 🧠 Parancsok (Slash Commands)

### 🎧 Általános parancsok
* `/join` – Csatlakozás a hangcsatornádhoz és az utolsó adó indítása.
* `/play <url>` – YouTube videó hangjának lejátszása.
* `/switch <név>` – Átváltás a listában szereplő rádióadók egyikére.
* `/list-channel` – Az összes mentett rádióadó böngészése interaktív gombokkal.
* `/leave` – Kilépés a csatornából és a lejátszás leállítása.
* `/help` – Segítség és parancslista.

### 🛠️ Adminisztrátor parancsok
* `/add-channel <név> <link>` – Új rádióadó végleges hozzáadása a listához.
* `/set-channel <név> <új_link>` – Meglévő adó URL címének módosítása.
* `/delete-channel <név>` – Adó törlése a listából.
* `/info <név>` – Egy adott adó stream linkjének lekérése.

---

## 📁 Technikai Felépítés

* **Runtime:** Node.js v24+
* **Library:** Discord.js v14.25+
* **Voice:** `@discordjs/voice` + `prism-media` (FFmpeg adapter)
* **Decoder:** `opusscript` (Szoftveres Opus kódolás)
* **Persistence:** JSON alapú adattárolás (`radios.json`, `last_radio.json`)

---

## 🛡️ Jogosultságok (Permissions)
A bot zavartalan működéséhez a következő jogosultságok szükségesek a szerveren:
* `Connect` & `Speak` (Csatlakozás és Beszéd).
* **`Set Voice Channel Status`** (Hangcsatorna-állapot beállítása).
* `Use Slash Commands` (Alkalmazásparancsok használata).

---

## 💾 Adatstruktúra (radios.json)
```json
[
  {
    "name": "TruckersFM",
    "url": "[https://live.truckers.fm/](https://live.truckers.fm/)"
  }
]
