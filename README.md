# ChatPPT

En lett satirisk chatbot for lærere. Fortell om planleggingstid som forsvant i et møte, eller om én voksen som skal være på fire stasjoner samtidig. Den oppdiktede rådgiveren finner som regel plass til utfordringen i PLO, «Planen for det ordinære», i klasserommet.

Svarene skrives på bokmål av OpenAI med utgangspunkt i lærerens egen melding. ChatPPT er en uavhengig parodi. Ved beskrivelser av akutt fare blir modellen bedt om å svare saklig og vise til hjelp.

## Kjør på egen maskin

Bruk Node.js 22.9 eller nyere. Prosjektet har ingen pakker som må installeres. Legg `OPENAI_API_KEY` i servermiljøet eller den lokale, Git-ignorerte filen `.env.local`. Start appen fra prosjektmappen.

```sh
node --env-file-if-exists=.env.local server.mjs
```

Åpne [ChatPPT på egen maskin](http://127.0.0.1:4173/). Testene kan kjøres med `node --test` og bruker simulerte modellsvar.

## Publiser fra GitHub

Koden kan ligge i ett GitHub-repo. For å få en fungerende chat på en GitHub Pages-adresse trenger du også en server som kan bruke API-nøkkelen. [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

1. Importer repoet til Vercel som et prosjekt med rammeverket **Other**. Legg inn `OPENAI_API_KEY` som en sensitiv miljøvariabel i Production. Sett `CHATPPT_ALLOWED_ORIGIN` til opprinnelsen for GitHub Pages, for eksempel `https://hrafnir.github.io`. Publiser prosjektet. Det serverer både nettsiden og `/api/chat`. [Vercels veiledning for GitHub](https://vercel.com/docs/git/vercel-for-github)
2. Velg **Settings → Pages → Source → GitHub Actions** i GitHub-repoet. Under **Settings → Secrets and variables → Actions → Variables** legger du inn variabelen `CHATPPT_API_URL` med den fullstendige, offentlige HTTPS-adressen til Vercel-funksjonen, inkludert `/api/chat`.
3. Åpne **Actions → Publiser ChatPPT på GitHub Pages → Run workflow**. Når kjøringen blir grønn, finner du nettadressen under **Settings → Pages**. Påfølgende endringer på `main` blir publisert automatisk. Kun innholdet i `public/` sendes til Pages.

Hvis du drifter din egen Node-server, kan GitHub Pages peke til dens HTTPS-adresse på samme måte. Bak en reversproxy setter du `CHATPPT_ALLOWED_ORIGIN` til nettadressens opprinnelse. Serveren lytter normalt på `127.0.0.1:4173`. Variablene `HOST` og `PORT` kan overstyre dette.

## API-bruk og samtaler

Standardmodellen er `gpt-5.6-luna` med inntil 300 utdata-tokens per svar. Én innsending utløser ett modellkall. Modellen får den nye meldingen og et kort utdrag av samtalen. `OPENAI_MODEL` kan settes til en annen modell som støtter Responses API, strukturerte svar og `reasoning.effort=none`. [Modell og tokenpriser](https://developers.openai.com/api/docs/models/gpt-5.6-luna)

Serveren begrenser bruken til 12 kall per klientadresse på ti minutter og som standard 200 kall per UTC-døgn per kjørende serverinstans. Juster antallet per døgn med `CHATPPT_DAILY_LIMIT`. Tellerne ligger i minnet. Flere serverinstanser har hver sine tellere, og en omstart nullstiller dem.

Samtalelisten lever i nettleserfanens minne. Teksten sendes via serveren til OpenAI med `store: false`. Bruk oppdiktede situasjoner og utelat elevopplysninger.

Språket spiller på ord som «handlingsrom» og «varierte læringsaktiviteter». PLO er parodiens faste konklusjon. [Udir om tilpasset opplæring](https://www.udir.no/laring-og-trivsel/lareplanverket/stotte/tilpasset-opplaring/)
