// Definição das 4 pistas do campeonato: traçado (pontos de controle), cenário e cores.
// Só dados — a geometria é construída em scene.js e o perfil de velocidade em race.js.

export const TRACKS = [
  {
    id: 'lago',
    name: 'Circuito do Lago',
    description: 'Traçado equilibrado, com uma reta boa e curvas médias.',
    ground: 0x5f9e4a,
    sky: 0x9fd3ff,
    tree: { trunk: 0x6b4a2b, leaf: 0x2f6b34, count: 420 },
    points: [
      [0, 0], [180, -20], [320, 60], [360, 220], [260, 330], [120, 290],
      [60, 400], [-120, 420], [-260, 300], [-240, 140], [-120, 90], [-160, -60],
    ],
  },
  {
    id: 'reta-grande',
    name: 'Reta Grande',
    description: 'Reta enorme e uma curva de retorno bem fechada. Marcha alta manda.',
    ground: 0xc2a25a,
    sky: 0xd9e9f5,
    tree: { trunk: 0x7a6440, leaf: 0x6f8f4a, count: 180 },
    points: [
      [0, 0], [200, 0], [400, 0], [560, 40], [600, 150], [520, 230],
      [380, 230], [200, 210], [40, 230], [-90, 190], [-110, 80], [-60, 10],
    ],
  },
  {
    id: 'serra',
    name: 'Serra',
    description: 'Curva atrás de curva. Quem acerta as marchas baixas ganha.',
    ground: 0x4a7f3d,
    sky: 0xbcd9e8,
    tree: { trunk: 0x5b3f26, leaf: 0x24512a, count: 620 },
    points: [
      [0, 0], [120, 40], [150, 150], [60, 200], [-40, 180], [-90, 260],
      [-20, 340], [110, 350], [220, 300], [300, 360], [280, 470], [150, 500],
      [20, 470], [-100, 480], [-200, 400], [-190, 260], [-230, 140], [-160, 30],
    ],
  },
  {
    id: 'anel',
    name: 'Anel Rápido',
    description: 'Curvas longas e abertas, quase tudo em cima do teto da 6ª.',
    ground: 0x6b8f4e,
    sky: 0xf2c48a,
    tree: { trunk: 0x6b4a2b, leaf: 0x3d5a2a, count: 260 },
    points: [
      [0, 0], [260, -60], [500, 20], [620, 220], [560, 430], [340, 540],
      [80, 540], [-160, 450], [-280, 260], [-240, 60], [-120, -60],
    ],
  },
];

export const trackById = (id) => TRACKS.find((t) => t.id === id) ?? TRACKS[0];
