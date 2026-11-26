import { ChangeDetectionStrategy, Component, inject, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HistoryService } from '../../core/services/history.service';
import { SettingsService } from '../../core/services/settings.service';
import { IconComponent } from '../../shared/icon.component';
import { MusicSearchComponent } from '../search/music-search.component';
import { PlayerSettingsComponent } from '../settings/player-settings.component';

@Component({
  selector: 'app-home-page',
  imports: [RouterLink, IconComponent, MusicSearchComponent, PlayerSettingsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="home">
      <button type="button" class="icon-btn gear" aria-label="Personalizar" (click)="settingsDlg().open()">
        <app-icon name="sliders" />
      </button>

      <div class="center">
        <h1 class="brand">Liriks</h1>
        <p class="tagline">La música, a través de sus letras.</p>

        <div class="search">
          <app-music-search />
        </div>

        @if (!hasKey()) {
          <p class="tip">
            Pega el enlace de YouTube de una canción para escucharla completa con su letra sincronizada.
          </p>
        }

        @if (history.recent().length) {
          <section class="recent" aria-labelledby="recent-title">
            <h2 id="recent-title">Escuchadas recientemente</h2>
            <ul>
              @for (t of history.recent(); track t.id) {
                <li>
                  <a class="card" [routerLink]="['/play', t.id]">
                    @if (t.artworkThumbUrl) {
                      <img [src]="t.artworkThumbUrl" alt="" width="56" height="56" loading="lazy" decoding="async" />
                    } @else {
                      <span class="ph" aria-hidden="true"></span>
                    }
                    <span class="txt">
                      <span class="t">{{ t.title }}</span>
                      <span class="a">{{ t.artist }}</span>
                    </span>
                  </a>
                </li>
              }
            </ul>
          </section>
        }
      </div>

      <footer class="credits">
        <a class="studio-link" routerLink="/studio">Estudio de sincronización · sincroniza tu propio audio</a>
        <br />
        Catálogo y portadas: Apple Music · Letras: LRCLIB · Reproducción: YouTube
      </footer>
    </main>
    <app-player-settings />
  `,
  styles: `
    :host {
      display: block;
      height: 100dvh;
    }
    .home {
      position: relative;
      z-index: 1;
      display: grid;
      grid-template-rows: 1fr auto;
      height: 100dvh;
      padding: calc(var(--safe-top) + 1rem) calc(var(--safe-right) + 1.25rem) calc(var(--safe-bottom) + 1rem)
        calc(var(--safe-left) + 1.25rem);
      overflow-y: auto;
    }
    .gear {
      position: absolute;
      top: calc(var(--safe-top) + 0.8rem);
      right: calc(var(--safe-right) + 0.8rem);
    }
    .center {
      align-self: center;
      justify-self: center;
      width: min(100%, 44rem);
      padding-block: 3rem 2rem;
    }
    .brand {
      margin: 0;
      font-size: clamp(3.6rem, 2rem + 7vw, 8rem);
      font-weight: 800;
      letter-spacing: -0.05em;
      line-height: 0.95;
      background: linear-gradient(100deg, #fff 30%, color-mix(in srgb, var(--color-accent) 70%, white) 100%);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    .tagline {
      margin: 0.8rem 0 clamp(1.6rem, 4vh, 2.6rem);
      font-size: clamp(1.05rem, 0.95rem + 0.5vw, 1.4rem);
      color: var(--color-text-secondary);
    }
    .search {
      position: relative;
      z-index: 5;
    }
    .tip {
      margin: 1.4rem 1.4rem 0;
      max-width: 34rem;
      font-size: var(--fs-meta);
      line-height: 1.5;
      color: var(--color-text-tertiary);
    }
    .recent {
      margin-top: clamp(2rem, 6vh, 3.5rem);
    }
    h2 {
      margin: 0 0 0.8rem 0.3rem;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--color-text-tertiary);
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
      gap: 0.5rem;
    }
    .card {
      display: flex;
      align-items: center;
      gap: 0.8rem;
      padding: 0.5rem 0.7rem 0.5rem 0.5rem;
      border-radius: 1rem;
      color: inherit;
      text-decoration: none;
      transition: background-color 0.2s;
    }
    .card:hover {
      background: var(--color-surface);
    }
    img,
    .ph {
      flex: none;
      width: 3.5rem;
      height: 3.5rem;
      border-radius: 0.55rem;
      object-fit: cover;
      background: var(--color-surface);
    }
    .txt {
      display: grid;
      min-width: 0;
    }
    .t,
    .a {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .t {
      font-weight: 600;
    }
    .a {
      font-size: var(--fs-meta);
      color: var(--color-text-secondary);
    }
    .studio-link {
      display: inline-block;
      margin-bottom: 0.5rem;
      color: var(--color-text-secondary);
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    .credits {
      padding-top: 1rem;
      text-align: center;
      font-size: 0.72rem;
      color: var(--color-text-tertiary);
    }
  `,
})
export class HomePage {
  protected readonly history = inject(HistoryService);
  private readonly settings = inject(SettingsService);
  protected readonly settingsDlg = viewChild.required(PlayerSettingsComponent);

  protected hasKey(): boolean {
    return this.settings.settings().youtubeApiKey.length > 0;
  }
}
