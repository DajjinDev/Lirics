import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Liriks — la música, a través de sus letras',
    loadComponent: () => import('./features/home/home.page').then((m) => m.HomePage),
  },
  {
    // :id = `itunes:<id>` o `yt:<videoId>`; ?v=<videoId> vincula un video concreto
    path: 'play/:id',
    loadComponent: () => import('./features/player/player.page').then((m) => m.PlayerPage),
  },
  {
    path: 'studio',
    title: 'Estudio de sincronización · Liriks',
    loadComponent: () => import('./features/studio/studio.page').then((m) => m.StudioPage),
  },
  { path: '**', redirectTo: '' },
];
