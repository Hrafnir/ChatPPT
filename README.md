# ChatPPT

ChatPPT er en uavhengig skoleparodi på bokmål. Den fiktive rådgiveren leser lærerens sak, anerkjenner tiltakene som er prøvd, og legger det videre pedagogiske arbeidet til klasserommet innenfor PLO, «Planen for det ordinære». Når modellen gjenkjenner en alvorlig hendelse, viser chatten først en egen boks med reell veiledning. Den satiriske vurderingen følger under.

## Kjør lokalt

Bruk Node.js 22.9 eller nyere. Legg `OPENAI_API_KEY` i servermiljøet eller i den lokale, Git-ignorerte filen `.env.local`. Du finner variabelnavnene i `.env.example`. Start serveren fra prosjektmappen.

```sh
node --env-file-if-exists=.env.local server.mjs
```

Åpne [ChatPPT lokalt](http://127.0.0.1:4173/). Standardadressen kan endres med `HOST` og `PORT`. Kjør `node --test` for å teste både API-et og Node-serveren med simulerte modellsvar.

## Publiser API-et med Sites

Nettleseren sender meldinger til `POST /api/chat`. Tjenesten kaller OpenAI og returnerer `reply` med satiresvaret og eventuelt `guidance` med separat veiledning. Den lokale serveren og Sites kjører samme behandlingskode fra `lib/worker.mjs`.

1. Koble Sites-prosjektet til riktig prosjekt-ID i `.openai/hosting.json`. Sett `OPENAI_API_KEY` som en hemmelighet i prosjektets kjøremiljø. Standardoppsettet tillater nettleserforespørsler fra `https://hrafnir.github.io`. For en annen nettside setter du `CHATPPT_ALLOWED_ORIGIN` til dens opprinnelse, uten prosjektsti.
2. Kjør `node scripts/build-sites.mjs` fra prosjektroten. Skriptet kopierer API-koden til `dist/server/index.js` og manifestet til `dist/.openai/hosting.json`. Publiser versjonen med Sites. For bruk fra en offentlig GitHub Pages-side må API-adressen ta imot anonyme forespørsler.
3. Kontroller at `/health` på Sites-adressen returnerer `status: "ok"`. Send deretter en kort, oppdiktet melding gjennom chatten for å kontrollere kontakten med OpenAI. Helseendepunktet bruker ingen API-kreditter.

## Publiser nettsiden med GitHub Pages

1. Velg **Settings → Pages → Source → GitHub Actions** i repoet.
2. Under **Settings → Secrets and variables → Actions → Variables** setter du `CHATPPT_API_URL` til Sites-prosjektets offentlige HTTPS-adresse med stien `/api/chat`. Denne adressen blir synlig for nettleseren. OpenAI-nøkkelen hører hjemme i API-ets kjøremiljø.
3. Kjør **Actions → Publiser ChatPPT på GitHub Pages → Run workflow**. Når variabelen er satt, kjøres arbeidsflyten også ved endringer på `main`. Den kjører testene, skriver API-adressen til `public/config.js` og publiserer innholdet i `public/`.

Repoets publiseringsadresse er [ChatPPT på GitHub Pages](https://hrafnir.github.io/ChatPPT/).

## API-bruk og samtaler

Standardmodellen er `gpt-5.6-luna`. Hver melding som passerer validering og bruksgrenser, utløser ett kall med inntil 300 utdata-tokens. Nettleseren sender den nye meldingen og inntil tre tidligere spørsmål og svar. API-et avgrenser konteksten til 6 000 tegn. `OPENAI_MODEL` kan brukes til å velge en annen modell som støtter Responses API, strukturerte svar og `reasoning.effort=none`. [Modell og tokenpriser](https://developers.openai.com/api/docs/models/gpt-5.6-luna)

Hver aktiv serverinstans tillater inntil 12 forespørsler per klientadresse i en timinuttersperiode og som standard 200 forespørsler totalt per UTC-døgn. `CHATPPT_DAILY_LIMIT` justerer døgnsgrensen per instans. Også mislykkede modellkall teller. Forespørsler uten synlig klientadresse deler én teller. Tellerne ligger i minnet, og nye eller omstartede instanser får egne tellere. Samlet forbruk kan derfor overstige døgnsgrensen.

Samtalen ligger i fanens minne til siden lastes på nytt eller fanen lukkes. API-et sender meldingene til OpenAI med `store: false`. Bruk oppdiktede eller anonymiserte situasjoner og utelat elevopplysninger.

Språket spiller på uttrykk som «handlingsrom» og «varierte læringsaktiviteter». PLO er parodiens faste konklusjon. [Udir om tilpasset opplæring](https://www.udir.no/laring-og-trivsel/lareplanverket/stotte/tilpasset-opplaring/)
