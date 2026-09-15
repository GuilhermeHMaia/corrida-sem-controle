# Corrida sem controle

Protótipo 3D de corrida controlado por gestos das mãos pela webcam (MediaPipe Hands + three.js). Sem build, sem instalar dependências: tudo vem de CDN.

## Rodar

É preciso servir por HTTP (a câmera não funciona abrindo o arquivo direto):

```bash
python -m http.server 5190
```

Abra `http://localhost:5190` no Chrome e escolha **Usar câmera** (ou **Modo teclado** pra testar sem câmera).

> Precisa de internet na primeira carga (three.js, MediaPipe e o modelo de mãos vêm de CDN).

## Objetivo

Faça a volta mais rápida. A volta só conta passando pelos 5 checkpoints em ordem e voltando à largada. A melhor volta fica salva no navegador.

- **Grama:** fora da pista o teto de velocidade da marcha cai pela metade.
- **Árvores:** bater para o carro.
- **Som:** motor acompanha a velocidade dentro da marcha, "clack" na troca, sinal nos checkpoints. `M` liga/desliga.

## Controles

O carro acelera sozinho até o teto da marcha atual.

| Gesto | Ação |
|---|---|
| Duas mãos abertas/semiabertas | Volante — o ângulo da linha entre as mãos esterça |
| Duas mãos fechando (≥ ~70%) | Freio — quanto mais fechadas, mais forte; punho total = freio total |
| Só a direita em punho (≥200 ms) | Sobe marcha |
| Só a esquerda em punho (≥200 ms) | Desce marcha |

- Troca de marcha só conta com a mão **100% fechada** (punho, os 4 dedos dobrados).
- Pra trocar de novo, reabra a mão. Depois de frear, abra as duas mãos antes da próxima troca.
- Durante freio, troca ou mão fora do quadro, a direção fica travada no último ângulo.
- **Calibre logo no início** (botão *Calibrar mãos* no painel da câmera): mãos abertas segurando o volante, depois punho totalmente fechado. O painel mostra o fechamento de cada mão em % (verde aberta, laranja zona de freio, vermelho punho).

Modo teclado: `←`/`→` volante, `Q`/`P` punho esquerdo/direito, `A`/`L` mão esquerda/direita 80% fechada, `Q+P` freio total, `A+L` freio leve, `H` simula mão fora do quadro, `R` zera o carro, `M` som.

## Ajustes

Tudo em `CONFIG` no topo de `src/logic.js`: tetos e taxas das marchas, força do freio, `brakeStart` (70%), `fullBrakeAt` (95%), `fist` (88%), fator da grama.

## Estrutura

- `src/logic.js` — mãos, gestos, física, colisão, voltas (puro, testável)
- `src/hands.js` — MediaPipe Hand Landmarker
- `src/scene.js` — pista, largada, árvores, carro, câmera
- `src/sound.js` — sons sintetizados (Web Audio)
- `src/main.js` — loop, HUD, calibração, teclado

## Testes

```bash
node --test tests/logic.test.mjs
```
