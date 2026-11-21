# Registre de devolucions (Firestore)

- Col·lecció `devolucions`: cada esdeveniment és un document nou.
- Regles (`firestore.rules`): només `create` (amb validació de camps/tipus i `ts == request.time`) i `read`. `update` i `delete` prohibits per a tothom.
- Configuració pública per a la web i l'userscript: `devolucions/registre-config.json` (`projectId`, `apiKey` web).

Desplegar les regles:

    cd firebase
    npx -y firebase-tools@latest deploy --only firestore:rules --project <PROJECT_ID>

Prova local (emulador):

    npx -y firebase-tools@latest emulators:start --only firestore --project demo-farmacia
    # i obrir devolucions/?registreEmulator=127.0.0.1:8080
