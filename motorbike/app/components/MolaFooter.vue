<template>
  <footer class="appFooter" :class="{ '-mounted': true }">
    <div class="left">
      <p>Copyright Yamê 2025. All rights reserved</p>
      <div class="links">
        <a href="#" @click.prevent>Terms of use</a>
        <a href="#" class="privacy" @click.prevent>Privacy policy</a>
        <a href="#" class="credits" @click.prevent>Credits</a>
      </div>
    </div>

    <div class="right">
      <a href="#" class="body-2 newsletter" @click.prevent>Join the Molazone</a>

      <div class="appSocial">
        <a href="https://www.youtube.com/@yamebantu" target="_blank" rel="noopener" aria-label="YouTube">
          <img src="/assets/images/3d/tmp-cdn-patch/images/youtube.svg" alt="YouTube" width="14" height="14">
        </a>
        <a href="https://www.instagram.com/yamebantu" target="_blank" rel="noopener" aria-label="Instagram">
          <img src="/assets/images/3d/tmp-cdn-patch/images/instagram.svg" alt="Instagram" width="14" height="14">
        </a>
        <a href="https://www.tiktok.com/@yamebantu" target="_blank" rel="noopener" aria-label="TikTok">
          <img src="/assets/images/3d/tmp-cdn-patch/images/tiktok.svg" alt="TikTok" width="14" height="14">
        </a>
      </div>

      <div class="appSwitchLocale body-2">
        <a href="#" class="-active" @click.prevent>EN</a>
        <span />
        <a href="#" @click.prevent>FR</a>
      </div>
    </div>
  </footer>
</template>
