# Sarjakell: paigaldusjuhend

Kõik kasutatavad teenused on tasuta: GitHub (äpi majutus ja igapäevane kontroll), Firebase'i Spark pakett (pere andmed) ja TVmaze (sarjade andmed). Krediitkaarti pole vaja. Ajakulu esimesel korral umbes 45 minutit.

Vajad: arvutit veebibrauseriga, Google'i kontot (Firebase'i jaoks) ja iPhone'i iOS 16.4 või uuemaga.

## 1. GitHub: hoidla ja veebiaadress

1. Loo konto aadressil github.com (kui seda pole).
2. Vajuta **New repository**. Nimi: `sarjakell`. Vali **Public** (tasuta GitHub Pages nõuab avalikku hoidlat; sinu pere andmed sinna ei satu, need on Firebase'is). Vajuta **Create repository**.
3. Vajuta **uploading an existing file** ja lohista sinna kõik kausta `sarjakell` failid ja kaustad (`index.html`, `app.js`, `styles.css`, `sw.js`, `config.js`, `manifest.webmanifest`, `firestore.rules`, kaustad `icons` ja `scripts`). Vajuta **Commit changes**.
4. Kaust `.github` on peidetud ja Mac jätab selle sageli üles laadimata. Lisa see käsitsi: **Add file → Create new file**, nimeks kirjuta täpselt `.github/workflows/kontroll.yml`, sisuks kopeeri faili `kontroll.yml` sisu. **Commit changes**.
5. **Settings → Pages**: Source = *Deploy from a branch*, Branch = `main`, kaust `/ (root)`. **Save**.
6. Mõne minuti pärast on äpp aadressil `https://KASUTAJANIMI.github.io/sarjakell/`. Esialgu näitab see teadet „Seadistamata“, see on õige.

## 2. Firebase: pere andmebaas

1. Ava console.firebase.google.com ja logi sisse Google'i kontoga.
2. **Create a project**, nimi `sarjakell`. Google Analytics lülita välja (pole vaja).
3. Vasakult **Build → Firestore Database → Create database**. Asukoht: `eur3 (europe-west)`. Režiim: **Production mode**.
4. Firestore'is ava vaheleht **Rules**, kustuta sealne sisu ja kopeeri asemele faili `firestore.rules` sisu. **Publish**.
5. Ava hammasratas → **Project settings → General**. All „Your apps“ juures vajuta veebiikooni `</>`, nimi `sarjakell`, Firebase Hostingut pole vaja. **Register app**.
6. Näed koodiplokki `const firebaseConfig = { apiKey: ..., ... }`. Ava GitHubis fail `config.js` (pliiatsiikoon), kopeeri kuue rea väärtused jutumärkide vahele õigetesse kohtadesse. Rida `vapidPublicKey` on juba täidetud, ära seda muuda. **Commit changes**.
   (Firebase'i veebivõtmed on mõeldud avalikuks, nende GitHubis olek on tavapärane. Andmeid kaitsevad reeglid sammust 4.)
7. **Project settings → Service accounts → Generate new private key**. Laadib alla JSON-faili. See on salajane: ära lae seda GitHubi.

## 3. GitHub: salajased võtmed igapäevasele kontrollile

Hoidlas **Settings → Secrets and variables → Actions → New repository secret**. Lisa neli saladust:

| Nimi | Väärtus |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Sammus 2.7 alla laaditud JSON-faili kogu sisu (ava tekstiredaktoriga, kopeeri kõik) |
| `VAPID_PUBLIC_KEY` | failist `salajased-votmed.txt` |
| `VAPID_PRIVATE_KEY` | failist `salajased-votmed.txt` |
| `VAPID_SUBJECT` | `mailto:` ja sinu e-posti aadress, näiteks `mailto:nimi@gmail.com` |

Pärast seda kustuta `salajased-votmed.txt` ja JSON-fail oma arvutist.

Proovi kontrolli: **Actions → Uute osade kontroll → Run workflow**. Roheline linnuke tähendab, et kõik töötab. Edaspidi käivitub kontroll iga päev ise kell 07:31 (suveajal 08:31).

## 4. iPhone'i paigaldamine

1. Ava **Safaris** aadress `https://KASUTAJANIMI.github.io/sarjakell/`.
2. Vajuta all **Jaga** nuppu → **Lisa avaekraanile** → **Lisa**.
3. Ava Sarjakell avaekraani ikoonilt (mitte Safarist).
4. **Loo uus pere** → lisa oma nimi.
5. Vajuta üleval paremal oma tähte → **Lülita teavitused sisse** → luba. Seejärel **Saada proovi-teavitus**.
6. Otsi sarjad vahekaardil **Otsi** ja vajuta **Lisa**.

Ikooni võid avalehel tõsta kausta või viimasele lehele, aga avalehelt eemaldada ei tohi: iPhone kustutab siis äpi.

## 5. Pereliikmete lisamine

Sinu profiilis: **Jaga pere koodi** (saad saata näiteks sõnumiga). Pereliige teeb läbi sammu 4 punktid 1 kuni 3, valib **Liitu perega**, sisestab koodi ja lisab oma nime. Igaüks lülitab teavitused sisse oma telefonis. Iga liige saab teavitusi ainult oma sarjade kohta.

Pere kood on ainus „parool“: jaga seda ainult pereliikmetega.

## Kuidas see töötab

- Äpp küsib sarjade ja osade andmed otse TVmaze'ist.
- Iga pereliikme sarjade nimekiri ja teavituste tellimused on Firebase'is.
- GitHub Actions käivitab igal hommikul skripti `scripts/check.mjs`, mis vaatab, kas mõne liikme sarjast ilmub järgmise 24 tunni jooksul uus osa, ja saadab teavituse. Sama osa kohta tuleb teavitus üks kord.

## Teadaolevad piirangud

- Teavitus tuleb kord päevas hommikul, mitte täpselt ilmumise minutil.
- Ilmumisaeg on TVmaze'i andmetes tavaliselt päritoluriigi eetriaeg; Eesti voogedastusplatvormidele võib osa jõuda hiljem.
- Kui keegi kustutab äpi telefonist, tuleb teavitused pärast uuesti paigaldamist uuesti sisse lülitada.
- Kui hoidlas pole 60 päeva muudatusi, peataks GitHub ajastuse; töövoog teeb selle vältimiseks ise vajadusel tühja muudatuse.

## Äpi muutmine hiljem

Kui muudad faile, suurenda failis `sw.js` esimesel real versiooni numbrit (`sarjakell-v1` → `sarjakell-v2`), et telefonid laadiksid uue versiooni.

Kujunduse eelvaate ilma andmebaasita näed aadressil `.../sarjakell/?demo` (näidisandmetega).
