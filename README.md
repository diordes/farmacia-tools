# 💊 Farmàcia Central BCN — Eines

Portal web amb eines internes per a la gestió de la farmàcia. Corre 100% al navegador, sense backend.

## Eines disponibles

### 📄 Factures
Busca factures al Gmail, renombra per Hisenda (`AAAA-MM-DD_PROVEIDOR_NumFactura_Import.pdf`), puja a Drive organitzades per proveïdor. Multi-compte, deduplicació automàtica.

- Requereix: Google Cloud Project amb Gmail API + Drive API activades
- OAuth2 multi-compte
- 48 proveïdors preconfigureats

### 💊 Neteja Genèrics
Puja l'export de Farmatic (Excel) i neteja automàticament:
- Elimina columnes de dades personals (Paciente, C.Cliente, Cliente, Receta)
- Anul·la parells venda/devolució
- Elimina genèrics (EFG), codis iguals, mateixa primera paraula
- Aplica llistes negres de laboratoris i productes
- Descarrega l'Excel netejat amb el sufix `_NETEJAT`

No requereix cap API externa — tot es processa al navegador amb SheetJS.

## Instal·lació

### 1. Pujar a GitHub

```bash
git init
git add .
git commit -m "Farmàcia Central BCN — portal eines"
git remote add origin https://github.com/diordes/farmacia-tools.git
git push -u origin main
```

### 2. Activar GitHub Pages

Settings → Pages → Source: Deploy from a branch → `main` → `/ (root)` → Save

La web serà accessible a: `https://diordes.github.io/farmacia-tools/`

### 3. Google Cloud (només per Factures)

1. Ves a [Google Cloud Console](https://console.cloud.google.com)
2. Crea un projecte nou
3. Activa: **Gmail API** + **Google Drive API**
4. Configura OAuth consent screen (External, test users: els teus comptes Gmail)
5. Crea OAuth Client ID (Web application):
   - Authorized JS origins: `https://diordes.github.io`
   - Authorized redirect URIs: `https://diordes.github.io`
6. Copia el Client ID i enganxa'l a Configuració dins l'eina Factures

## Estructura

```
farmacia-tools/
├── index.html              # Portal principal
├── css/portal.css          # Estils compartits
├── factures/               # Eina de factures
│   ├── index.html
│   ├── css/style.css
│   └── js/ (12 mòduls)
├── generics/               # Eina de neteja genèrics
│   ├── index.html
│   ├── style.css
│   ├── cleaner.js
│   └── app.js
└── README.md
```

## Privacitat

- Tot corre al navegador — cap dada surt del teu ordinador (excepte cap a Google per l'eina Factures)
- No hi ha backend ni servidor
- Codi obert — pots auditar cada línia

## Llicència

Ús privat per Farmàcia Central BCN.
