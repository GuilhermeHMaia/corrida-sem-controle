# Corrida sem controle

Protótipo 3D de corrida controlado por gestos das mãos pela webcam (MediaPipe Hands + three.js). Sem build, sem instalar dependências: tudo vem de CDN.

## Rodar

É preciso servir por HTTP (a câmera não funciona abrindo o arquivo direto):

```bash
python -m http.server 5190
```

Abra `http://localhost:5190` no Chrome e escolha **Usar câmera** (ou **Modo teclado** pra testar sem câmera).

> Precisa de internet na primeira carga (three.js, MediaPipe e o modelo de mãos vêm de CDN).

## Controles

O carro acelera sozinho até o teto da marcha atual.

| Gesto | Ação |
|---|---|
| Duas mãos abertas/semiabertas | Volante — o ângulo da linha entre as mãos esterça |
| Duas mãos fechadas | Freio progressivo (30% → 100% em 1 s) |
| Só a direita fechada (≥200 ms) | Sobe marcha |
| Só a esquerda fechada (≥200 ms) | Desce marcha |

- Pra trocar de novo, reabra a mão. Depois de frear, abra as duas mãos antes da próxima troca.
- Com qualquer mão fechada ou fora do quadro, a direção fica travada no último ângulo.
- **Calibre logo no início** (botão *Calibrar mãos* no painel da câmera): 2 s com as mãos abertas segurando o volante, 2 s fechadas. Os limiares ficam salvos no navegador.

Modo teclado: `←`/`→` volante, `Q` mão esquerda fechada, `P` mão direita fechada, `Q+P` freio, `H` simula mão fora do quadro, `R` zera o carro.

## Estrutura

- `src/logic.js` — classificação das mãos, interpretação dos gestos, física (parâmetros em `CONFIG`)
- `src/hands.js` — MediaPipe Hand Landmarker
- `src/scene.js` — pista, carro, câmera
- `src/main.js` — loop, HUD, calibração, teclado

## Testes

```bash
node --test tests/logic.test.mjs
```
