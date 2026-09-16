# Corrida sem controle

Protótipo 3D de corrida controlado por gestos das mãos pela webcam (MediaPipe Hands + three.js). Sem build, sem instalar dependências: tudo vem de CDN.

## Rodar

É preciso servir por HTTP (a câmera não funciona abrindo o arquivo direto):

```bash
python -m http.server 5190
```

Abra `http://localhost:5190` no Chrome e escolha **Usar câmera** (ou **Modo teclado** pra testar sem câmera).

> Precisa de internet na primeira carga (three.js, MediaPipe e o modelo de mãos vêm de CDN).

## Modos

No menu (`Esc` a qualquer momento):

- **Campeonato** — 4 corridas, uma em cada pista, 3 voltas cada, contra 3 adversários. Pontos 10/7/5/3 por corrida e tabela acumulada; fica salvo, dá pra continuar depois ou zerar.
- **Corrida avulsa** — escolha a pista e corra contra os mesmos 3 adversários.
- **Treino livre** — sozinho na pista, sem contagem nem adversários.

### Pistas

| Pista | Perfil |
|---|---|
| Circuito do Lago | Equilibrada, uma reta boa e curvas médias |
| Reta Grande | Reta enorme e uma curva de retorno fechada |
| Serra | Curva atrás de curva, marchas baixas |
| Anel Rápido | Curvas longas e abertas, quase tudo em 6ª |

Antes de cada corrida aparece a **prévia da pista**: mapa do traçado com a largada marcada, extensão, número de voltas, sua melhor volta e os adversários. A escolha de pista também mostra uma miniatura de cada traçado.

Durante a corrida, o **minimapa** no canto direito mostra o traçado com norte pra cima, seu carro em amarelo e cada adversário na cor dele.

### Regras da pista

- A volta só conta passando pelos 5 checkpoints em ordem e voltando à largada. A melhor volta de cada pista fica salva.
- **Grama:** fora da pista o teto de velocidade da marcha cai pela metade.
- **Árvores:** bater para o carro. **Adversários:** o toque atrapalha os dois.
- **Largada:** contagem de 3 segundos com o carro parado; você sai em último.
- **Som:** motor acompanha a velocidade dentro da marcha, "clack" na troca, sinal nos checkpoints. `M` liga/desliga.

## Visão de dentro

O jogo começa com a câmera no banco do motorista (`C` alterna com a visão de fora; a escolha fica salva). Posição de simulador: a pista ocupa a maior parte da tela e só a metade de cima do volante aparece embaixo. `↑`/`↓` sobem/descem o banco (fica salvo).

- O volante na tela gira **1:1 com o ângulo das suas mãos** (sem zona morta); o carro continua esterçando pela regra normal. Durante freio/troca ele trava junto com a direção.
- As **luvas** no aro abrem e fecham acompanhando suas mãos: verdes abertas, laranja na zona de freio, vermelhas em punho. Somem se a mão sair do quadro.
- As **borboletas** atrás do volante acendem na troca: direita sobe, esquerda desce.
- Velocidade, marcha, rotação e freio ficam no **display do volante**.

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

Modo teclado: `←`/`→` volante, `Q`/`P` punho esquerdo/direito, `Z`/`L` mão esquerda/direita 80% fechada, `Q+P` freio total, `Z+L` freio leve, `H` simula mão fora do quadro, `R` zera o carro, `M` som, `C` câmera, `↑`/`↓` altura do banco, `A` ajustes, `Esc` menu.

## Ajustes (tecla `A`)

Painel dentro do jogo, com efeito imediato e salvo no navegador:

- **Freio começa com a mão fechada em** (padrão 70%) — suba se o freio dispara só de segurar o volante.
- **Punho a partir de** (88%) — desça se o punho fechado não é reconhecido. Sempre fica pelo menos 5 pontos acima do freio.
- **Força do freio** (70 km/h por segundo).
- **Inclinação das mãos para esterço total** (45°) — menor deixa a direção mais sensível.
- **Suavização do volante**, **altura do banco** e **volume**.

O resto (tetos e taxas das marchas, `fullBrakeAt`, fator da grama) fica em `CONFIG`, no topo de `src/logic.js`. Para inspecionar no console, abra com `?debug=1` e use `window.__jogo`.

## Estrutura

- `src/logic.js` — mãos, gestos, física, colisão, voltas (puro, testável)
- `src/race.js` — adversários, classificação, largada e campeonato (puro, testável)
- `src/tracks.js` — as 4 pistas (traçado e cenário)
- `src/map.js` — projeção do traçado pro mapa da prévia e pro minimapa (puro, testável)
- `src/hands.js` — MediaPipe Hand Landmarker
- `src/scene.js` — pistas, largada, árvores, carros, câmeras
- `src/cockpit.js` — interior, volante com display, borboletas, luvas
- `src/sound.js` — sons sintetizados (Web Audio)
- `src/main.js` — menus, ajustes, loop, HUD, calibração, teclado

## Testes

```bash
node --test tests/*.test.mjs
```
