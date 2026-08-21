(function (root) {
  'use strict';

  const BOARD_SIZES = [8, 10, 12];

  const FLEET_PRESETS = {
    compact: {
      label: 'Compact Fleet',
      ships: [
        { name: 'Cruiser', size: 3 },
        { name: 'Submarine', size: 3 },
        { name: 'Destroyer', size: 2 },
      ],
    },
    classic: {
      label: 'Classic Fleet',
      ships: [
        { name: 'Carrier', size: 5 },
        { name: 'Battleship', size: 4 },
        { name: 'Cruiser', size: 3 },
        { name: 'Submarine', size: 3 },
        { name: 'Destroyer', size: 2 },
      ],
    },
    armada: {
      label: 'Armada Fleet',
      ships: [
        { name: 'Carrier', size: 5 },
        { name: 'Battleship', size: 4 },
        { name: 'Cruiser', size: 3 },
        { name: 'Submarine', size: 3 },
        { name: 'Frigate', size: 3 },
        { name: 'Destroyer', size: 2 },
        { name: 'Scout', size: 2 },
      ],
    },
  };

  const DEFAULT_BOARD_SIZE = 10;
  const DEFAULT_FLEET = 'classic';

  const api = { BOARD_SIZES, FLEET_PRESETS, DEFAULT_BOARD_SIZE, DEFAULT_FLEET };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.GameConfig = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
