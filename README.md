# 📻 Bento Radio – Discord Rádió Bot

**Bento Radio** egy fejlett, interaktív Discord bot, amely képes online rádióállomások streamelésére egy voice csatornában. Slash parancsokkal vezérelhető, gombos kezelőfelülettel, és JSON-alapú rádiókezeléssel működik.

---

## ⚙️ Előkészületek

1. **Node.js** telepítése (ajánlott: `18.x` vagy újabb)
2. `.env` fájl létrehozása a következő tartalommal:

    ```env
    TOKEN=your-bot-token
    GUILD_ID=your-guild-id
    VOICE_CHANNEL_ID=your-voice-channel-id
    ```

3. Függőségek telepítése:

    ```bash
    npm install discord.js @discordjs/voice ffmpeg-static dotenv
    ```

4. Bot indítása:

    ```bash
    node index.js
    ```

---

## 📁 Fájlstruktúra

📦 root
┣ 📄 index.js <- A bot teljes működését tartalmazza
┣ 📄 .env <- Privát kulcsok (TOKEN, VOICE_CHANNEL_ID, GUILD_ID)
┣ 📄 radios.json <- Felhasználó által hozzáadott rádióadók listája
┣ 📄 last_radio.json <- Utoljára lejátszott rádió indexe
┣ 📦 node_modules
┣ 📄 package.json


---

## 🔑 .env változók

| Változó | Leírás |
|--------|--------|
| `TOKEN` | A bot Discord tokenje |
| `VOICE_CHANNEL_ID` | Voice csatorna ID, ahová a bot csatlakozik |
| `GUILD_ID` | Szerver ID, ahol a parancsok regisztrálódnak |

---

## 🧠 Funkciók

### 🎧 `/join`
- Belépteti a botot a voice csatornába
- Lejátssza az utoljára kiválasztott rádió streamet

### 🎚️ `/switch <név>`
- Átvált a megadott rádióadóra
- Frissíti a bot „activity” állapotát

### ➕ `/add-channel <név> <link>`
- Új rádiócsatorna hozzáadása
- Csak adminisztrátorok számára elérhető
- Ellenőrzi, hogy a stream URL érvényes-e

### 🧾 `/list-channel`
- Elérhető rádióadók listázása lapozható, gombos felülettel
- A jelenlegi rádió zöld gombbal kiemelve

### 🗑️ `/delete-channel <név>`
- Megadott nevű rádiót törli
- Csak adminisztrátorok számára elérhető

### 🛠️ `/set-channel <név> <új_link>`
- Rádió stream link módosítása megerősítéssel
- Csak adminisztrátorok számára elérhető

### ℹ️ `/info <név>`
- Lekérdezi egy rádió stream URL-jét

### 🛑 `/leave`
- Kilépteti a botot a voice csatornából

### ❓ `/help`
- Parancslista és rövid magyarázat

---

## 🔊 Lejátszás

- A bot `ffmpeg-static` segítségével alakítja át a rádió streamet PCM formátumra
- `createAudioPlayer` + `createAudioResource` segítségével játszik le
- Hanghiba esetén újraindul

---

## 💾 Adatfájlok

### `radios.json`
```json
[
  {
    "name": "Example FM",
    "url": "http://example.com/stream"
  }
]
```
## 📈 Technikai adatok

- Node.js alapú projekt

- Használt csomagok: discord.js, @discordjs/voice, ffmpeg-static, dotenv

- Parancsok: SlashCommandBuilder + gombos interakciók

- Admin-only parancsok külön jogosultsággal (PermissionsBitField.Flags.Administrator)

- Hang stream kezelés: FFmpeg, Pipe, Discord voice adapter

## 🛡️ Megjegyzés
Ez a bot csak jogtiszta, nyilvánosan elérhető rádió stream linkekkel használható. Kérlek, **ne használd** szerzői jogokat sértő stream URL-ekkel!

Készítette: Tóth Bence, Programtervező informatikus hallgató

