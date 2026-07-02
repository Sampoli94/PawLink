# 🐾 PawLink

**PawLink** è una piattaforma collaborativa full-stack (Web App e futura PWA mobile) creata per il soccorso, la gestione e il monitoraggio degli animali randagi sul territorio. Consente la cooperazione immediata tra **Cittadini**, **Volontari**, **Rifugi** e **Veterinari**.

---

## 🛠️ Struttura del Progetto

Il progetto è strutturato come un monorepo:
* **`/client`**: Frontend in React (Vite) con una splendida interfaccia dark e in stile glassmorphism. Include una mappa interattiva SVG per geolocalizzare i randagi, chat per i soccorsi, una Clinica IA per autodiagnosi/triage e un sistema di raccolta punti.
* **`/server`**: Backend in Node.js (Express) con API REST complete. Gestisce la registrazione utenti con ruoli, il caricamento foto, il tracciamento dei punti e la simulazione in tempo reale di chat e mappe. Utilizza un database JSON locale (`database.json`) per essere 100% pronto all'uso senza configurazioni complesse.

---

## 🚀 Come Avviare il Progetto

Per avviare sia il frontend che il backend contemporaneamente, ti basta aprire un terminale nella cartella principale del progetto (`C:\Users\Samuele\pawlink`) e digitare:

```bash
npm run dev
```

Questo comando, grazie a `concurrently`, avvierà in parallelo:
1. Il **Server Backend** su: [http://localhost:5000](http://localhost:5000)
2. Il **Client Frontend** su: [http://localhost:5173](http://localhost:5173) (o altra porta aperta indicata nel terminale)

Apri il link del client sul tuo browser per testare l'applicazione!

---

## 🌟 Funzionalità Principali Implementate

1. **Autenticazione con Ruoli**: Registrazione e login per *Cittadino* o *Volontario*.
2. **Mappa dei Soccorsi**: Mappa interattiva con segnalazioni attive, cliniche veterinarie, negozi di animali e "hotspot" (zone ad alta densità di segnalazioni).
3. **Modulo di Segnalazione GPS**: Consente di posizionare un marker sulla mappa cliccandoci sopra, selezionare una foto e inserire una descrizione.
4. **Moderazione Foto Intelligente**: Se una segnalazione contiene parole come *"sangue"*, *"ferita"*, *"grave"*, l'immagine dell'animale viene automaticamente sfocata sul feed con un avviso di contenuto sensibile e un pulsante per svelarla.
5. **Chat di Coordinamento**: Presa in carico del soccorso da parte di un volontario, che sblocca una chat privata temporanea con il segnalatore per organizzare il recupero.
6. **Gamification (Raccolta Punti)**: Il completamento dei soccorsi assegna punti utilizzabili per riscattare sconti in cibo e visite presso i negozi convenzionati.
7. **Clinica IA (Triage)**: Un assistente virtuale valuta i sintomi inseriti ed emette un codice di urgenza (Verde, Giallo, Rosso) con consigli utili e disclaimer legali.
