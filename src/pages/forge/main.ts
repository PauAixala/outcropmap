/** Entry point for the forging calculator page (forge.html). */
// Deliberately not the `@ui/components` barrel, and no `@worldgen/profiles`: either one drags the
// map's world generators into this page (~450 kB) for a calculator that never generates a world.
import { initTheme } from '@ui/theme/theme';
import { mountHeader } from '@ui/components/header';
import { RAIL_MIN_VIEWPORT, hasAd, mountAdSlot } from '@ui/components/ad-slot';
import { mountForgePicker } from '@ui/components/forge-picker';
import { mountForgeRecipes } from '@ui/components/forge-recipes';
import { en } from '@ui/i18n/en';
import { createStorage } from '@platform/storage';
import {
  loadProfilePreference,
  loadSeedPreference,
  saveProfilePreference,
  saveSeedPreference,
} from '@app/profile-preference';

// The document title comes from i18n like every other string a person reads.
document.title = en.pageTitles.forge;

function mountForgeHero(): void {
  const title = document.getElementById('forge-hero-title');
  const body = document.getElementById('forge-hero-body');
  if (title) title.textContent = en.forge.heroTitle;
  if (body) body.textContent = en.forge.heroBody;
}

async function boot(): Promise<void> {
  await initTheme();

  const headerEl = document.getElementById('app-header');
  if (headerEl) mountHeader(headerEl, { page: 'forge' });
  mountForgeHero();

  const storage = createStorage();
  const initialProfile = (await loadProfilePreference(storage)) ?? 'tfc-1.20';
  // The same stored seed the map uses: a player looking at one world should not type it twice.
  const initialSeed = await loadSeedPreference(storage);

  // Declared before the picker so its profile-change handler can reach it: the deltas on the
  // custom-recipe buttons come from the selected catalogue and have to follow it.
  let editor: { readonly refreshActionLabels: () => void } | null = null;

  const pickerEl = document.getElementById('recipe-picker');
  const picker = pickerEl
    ? mountForgePicker(pickerEl, {
        initialProfile,
        initialSeed,
        onProfileChange: (profile) => {
          void saveProfilePreference(storage, profile).catch(() => {});
          editor?.refreshActionLabels();
        },
        onSeedChange: (seed) => {
          if (seed !== null) void saveSeedPreference(storage, seed).catch(() => {});
        },
      })
    : null;
  if (picker) void saveProfilePreference(storage, picker.profile()).catch(() => {});

  // Ads, in a build that has them: one block between the calculator and the custom-recipe tools,
  // one at the end of the page, and on each side a rail ad that follows the scroll, where the
  // screen is wide enough for it.
  const mainEl = document.querySelector('.app-main');
  if (pickerEl && hasAd('forgeMiddle')) {
    const middle = document.createElement('div');
    middle.className = 'forge-ad';
    pickerEl.after(middle);
    mountAdSlot(middle, 'forgeMiddle');
  }
  if (mainEl && hasAd('forgeEnd')) {
    const end = document.createElement('div');
    end.className = 'forge-ad';
    mainEl.append(end);
    mountAdSlot(end, 'forgeEnd');
  }
  const wide = window.matchMedia(`(min-width: ${RAIL_MIN_VIEWPORT.forge}px)`).matches;
  if (mainEl instanceof HTMLElement && wide && (hasAd('forgeLeft') || hasAd('forgeRight'))) {
    const layout = document.createElement('div');
    layout.className = 'forge-layout';
    const left = document.createElement('div');
    left.className = 'forge-rail forge-rail--left';
    const right = document.createElement('div');
    right.className = 'forge-rail forge-rail--right';
    mainEl.before(layout);
    layout.append(left, mainEl, right);
    mountAdSlot(left, 'forgeLeft');
    mountAdSlot(right, 'forgeRight');
  }
  // The disclaimer the Minecraft Usage Guidelines ask of fan sites.
  const disclaimer = document.createElement('p');
  disclaimer.className = 'site-disclaimer';
  disclaimer.textContent = en.disclaimer;
  mainEl?.append(disclaimer);

  // Custom recipe editor + saved recipes list (docs/PLAN.md section 14): the two sections are one
  // feature — opening a saved recipe fills the editor form.
  const editorEl = document.getElementById('recipe-editor');
  const savedEl = document.getElementById('saved-recipes');
  if (editorEl !== null && savedEl !== null) {
    editor = mountForgeRecipes(editorEl, savedEl, {
      profile: () => picker?.profile() ?? initialProfile,
      storage,
    });
  }

  // The solved sequence is not a section of its own: it renders inside whichever recipe is
  // selected (10c), so `mountForgePicker` and `mountForgeRecipes` each own a solve panel.
}

void boot();

export {};
