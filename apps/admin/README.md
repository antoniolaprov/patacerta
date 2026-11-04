# PataCerta Admin

Painel da clínica em Angular (componentes standalone e signals).

```bash
npm install
npm start        # http://localhost:4200
npx ng test --watch=false
npx ng build
```

Para apontar para outros endereços sem recompilar, defina `window.__PATACERTA__ = { apiUrl, aiUrl }` no `index.html`.
