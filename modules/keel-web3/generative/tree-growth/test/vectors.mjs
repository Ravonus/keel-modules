const checksum = (values) => Math.round([...values].reduce((sum, value, index) => sum + value * ((index % 7) + 1), 0) * 1000);

const frameAt = (api, model, share) => api.treeFrame(model, api.cycleAt(model, share * 12, 12), { ground: 0 });

/** Living, dead and fallen internodes in a frame. */
const census = (model, frame) => {
  let living = 0;
  let dead = 0;
  let fallen = 0;
  for (let node = 0; node < model.count; node += 1) {
    if (frame.grow[node] <= 0 || frame.rot[node] >= 1) continue;
    if (frame.fall[node] > 0) fallen += 1;
    else if (frame.dead[node] > 0.5) dead += 1;
    else living += 1;
  }
  return { living, dead, fallen };
};

const day = (api, value, hemisphere = 'north', species = 'cherry') => api.yearState({ species, day: value, year: 2026, hemisphere });

export default [
  {
    name: 'the same species and seed always grow the same tree; another seed grows another',
    run: ({ growTree }) => {
      const a = growTree({ species: 'cherry', seed: 7 });
      const b = growTree({ species: 'cherry', seed: 7 });
      const c = growTree({ species: 'cherry', seed: 8 });
      return [a.count === b.count, checksum(a.x) === checksum(b.x), checksum(a.x) !== checksum(c.x)];
    },
    expect: [true, true, true],
  },
  {
    name: 'the graph is ordered: every internode comes after its parent, and leaves hang on real nodes',
    run: ({ growTree }) => {
      const tree = growTree({ species: 'oak', seed: 11 });
      let ordered = tree.parent[0] === -1;
      for (let node = 1; node < tree.count; node += 1) ordered &&= tree.parent[node] >= 0 && tree.parent[node] < node;
      let attached = true;
      for (let index = 0; index < tree.leaves.count; index += 1) attached &&= tree.leaves.node[index] < tree.count;
      return [ordered, attached, tree.count > 500];
    },
    expect: [true, true, true],
  },
  {
    name: 'a tree starts as one tiny sprout and only ever gets taller while it lives',
    run: (api) => {
      const tree = api.growTree({ species: 'cherry', seed: 7 });
      const sprout = frameAt(api, tree, 0);
      const heights = [0.1, 0.3, 0.5, 0.7].map((share) => frameAt(api, tree, share).height);
      const rising = heights.every((height, index) => index === 0 || height > heights[index - 1]);
      return [sprout.visible, sprout.height < 0.2, rising, heights[3] > 6];
    },
    expect: [1, true, true, true],
  },
  {
    name: 'the trunk thickens by the pipe model while twigs stay twig-thin',
    run: (api) => {
      const tree = api.growTree({ species: 'cherry', seed: 7 });
      const young = frameAt(api, tree, 0.2);
      const grown = frameAt(api, tree, 0.6);
      let twig = 0;
      for (let node = 0; node < tree.count; node += 1) if (grown.grow[node] > 0 && grown.tips[node] <= 1.01) twig = Math.max(twig, grown.radius[node]);
      return [grown.radius[0] > young.radius[0], grown.radius[0] > twig * 8, twig <= tree.species.radiusTip + 1e-6];
    },
    expect: [true, true, true],
  },
  {
    name: 'old age is a slow decline: the crown thins, then everything is dead at the end',
    run: (api) => {
      const tree = api.growTree({ species: 'cherry', seed: 7 });
      const [mature, old, ancient, end] = [0.6, 0.85, 0.95, 1].map((share) => census(tree, frameAt(api, tree, share)));
      return [old.living < mature.living, ancient.living < old.living, ancient.living > 0, end.living];
    },
    expect: [true, true, true, 0],
  },
  {
    name: 'shed limbs fall to the ground and lie flat on it, inside the plot',
    run: (api) => {
      const tree = api.growTree({ species: 'acacia', seed: 5 });
      const frame = api.treeFrame(tree, tree.cycles - 3, { ground: 0.06 });
      let lying = 0;
      let below = 0;
      let reach = 0;
      let raised = 0;
      for (let node = 0; node < tree.count; node += 1) {
        if (frame.grow[node] <= 0) continue;
        if (frame.y[node] < 0.06 - 1e-3) below += 1;
        if (frame.fall[node] < 1 || frame.rot[node] >= 1) continue;
        lying += 1;
        reach = Math.max(reach, Math.hypot(frame.x[node], frame.z[node]));
        raised = Math.max(raised, frame.y[node] - 0.06);
      }
      return [lying > 0, below, reach < 6, raised < 0.35];
    },
    expect: [true, 0, true, true],
  },
  {
    name: 'species keep their shape: pine is narrow and tall, acacia a wide flat crown',
    run: ({ growTree, treeFrame }) => ['pine', 'acacia'].map((species) => {
      const tree = growTree({ species, seed: 3 });
      const frame = treeFrame(tree, tree.matureAt);
      let reach = 0;
      for (let node = 0; node < tree.count; node += 1) if (frame.grow[node] > 0 && frame.fall[node] === 0) reach = Math.max(reach, Math.hypot(frame.x[node], frame.z[node]));
      return (2 * reach) / frame.height < 1.35;
    }),
    expect: [true, false],
  },
  {
    name: 'a northern cherry blooms before it leafs out, colors, drops, then rests bare',
    run: (api) => {
      const april = day(api, 100);
      const june = day(api, 170);
      const october = day(api, 300);
      const january = day(api, 15);
      return [april.bloom > 0.9 && april.leaf === 0, june.leaf === 1 && june.petals === 1, october.color === 1 && october.drop > 0.2, january.dormant && january.leaf === 0];
    },
    expect: [true, true, true, true],
  },
  {
    name: 'the southern hemisphere runs half a year apart; evergreens keep their needles',
    run: (api) => {
      const southOctober = day(api, 282, 'south');
      const pineJanuary = day(api, 15, 'north', 'pine');
      return [southOctober.bloom > 0.9, pineJanuary.leaf, pineJanuary.drop < 0.2, pineJanuary.dormant];
    },
    expect: [true, 1, true, false],
  },
  {
    name: 'each species bears its own flowers and fruit; an oak holds dead leaves through winter',
    run: (api) => {
      const kinds = api.SPECIES_IDS.map((id) => `${api.SPECIES[id].flower?.kind ?? '-'}/${api.SPECIES[id].fruit?.kind ?? '-'}`);
      const oakJanuary = day(api, 15, 'north', 'oak');
      const birchJanuary = day(api, 15, 'north', 'birch');
      const cherryJune = day(api, 165, 'north', 'cherry');
      return [kinds.join(' '), oakJanuary.withered && oakJanuary.leaf > 0, birchJanuary.withered, cherryJune.fruit > 0.5];
    },
    expect: ['blossom/cherry catkin/acorn candle/cone catkin/- catkin/- puff/pod spadix/coconut candle/cone -/cone puff/samara blossom/pod bell/gourd', true, false, true],
  },
  {
    name: 'a spruce closes to a spire, a redwood stands bare below, a baobab swells at the foot',
    run: (api) => {
      const grown = (species) => { const model = api.growTree({ species, seed: 3, maxNodes: 1600 }); return { model, frame: frameAt(api, model, 0.6) }; };
      /** Widest reach of living wood in a band of the tree's height. */
      const width = ({ model, frame }, low, high) => {
        let reach = 0;
        for (let node = 0; node < model.count; node += 1) {
          const share = frame.y[node] / frame.height;
          if (frame.grow[node] > 0 && share >= low && share < high) reach = Math.max(reach, Math.hypot(frame.x[node], frame.z[node]));
        }
        return reach;
      };
      const lowest = ({ model, frame }) => {
        let y = Infinity;
        for (let node = 1; node < model.count; node += 1) if (frame.grow[node] > 0 && frame.dead[node] <= 0.5 && frame.fall[node] <= 0 && model.order[node] > 0) y = Math.min(y, frame.y[node]);
        return y / frame.height;
      };
      const spruce = grown('spruce'), redwood = grown('redwood'), baobab = grown('baobab'), maple = grown('maple');
      const footShare = ({ frame }) => frame.radius[0] / frame.height;
      return [width(spruce, 0.75, 1) < width(spruce, 0.1, 0.4) * 0.6, lowest(redwood) > lowest(spruce) + 0.2, footShare(baobab) > footShare(maple) * 1.4];
    },
    expect: [true, true, true],
  },
  {
    name: 'old trees keep growing through their decline, less each cycle, until the end',
    run: ({ growTree }) => ['cherry', 'oak', 'palm'].map((species) => {
      const tree = growTree({ species, seed: 4 });
      const born = new Array(tree.cycles + 1).fill(0);
      for (let node = 0; node < tree.count; node += 1) born[Math.floor(tree.birth[node])] += 1;
      const late = born.slice(tree.matureAt + 1, tree.cycles - 2);
      return late.every((count) => count > 0) && late[late.length - 1] < late[0];
    }),
    expect: [true, true, true],
  },
  {
    name: 'a palm is one unbranched trunk of one girth; at death its crown drops and the pole stands',
    run: (api) => {
      const tree = api.growTree({ species: 'palm', seed: 9 });
      let maxOrder = 0;
      for (let node = 0; node < tree.count; node += 1) maxOrder = Math.max(maxOrder, tree.order[node]);
      const [young, old] = [0.4, 0.8].map((share) => frameAt(api, tree, share));
      const end = api.treeFrame(tree, tree.cycles, { ground: 0 });
      let crown = 0;
      for (let node = 0; node < tree.count; node += 1) if (tree.order[node] > 0 && end.grow[node] > 0 && end.fall[node] === 0) crown += 1;
      return [maxOrder, Math.abs(young.radius[5] - old.radius[5]) < 1e-6, old.height > young.height, crown, tree.fruit.count > 0];
    },
    expect: [1, true, true, 0, true],
  },
  {
    name: 'unknown species grow a cherry instead of failing',
    run: ({ growTree, speciesOf }) => [speciesOf('<script>').id, growTree({ species: 'nope', seed: 1, maxNodes: 80 }).count <= 80],
    expect: ['cherry', true],
  },
];
