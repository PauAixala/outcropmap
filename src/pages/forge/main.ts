/** Entry point for the forging calculator page (forge.html). */
// Deliberately not the `@ui/components` barrel, and no `@worldgen/profiles`: either one drags the
// map's world generators into this page (~450 kB) for a calculator that never generates a world.
import { initTheme } from '@ui/theme/theme';
import { mountHeader } from '@ui/components/header';
import { mountAdSlot } from '@ui/components/ad-slot';
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

  // One ad unit between the calculator and the custom-recipe tools, in a build that has ads.
  if (pickerEl) {
    const adBox = document.createElement('div');
    adBox.className = 'forge-ad';
    pickerEl.after(adBox);
    if (!mountAdSlot(adBox, 'forge')) adBox.remove();
  }
  // The disclaimer the Minecraft Usage Guidelines ask of fan sites.
  const disclaimer = document.createElement('p');
  disclaimer.className = 'site-disclaimer';
  disclaimer.textContent = en.disclaimer;
  document.querySelector('.app-main')?.append(disclaimer);

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
