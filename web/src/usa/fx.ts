/** usa-fx + 效果包：点击（ripple / confetti / burst）、光与材质（pearlescent / brushed-metal）、光标（comet-trail）、音乐（spectrum-mirror / sound-particles）。 */
import { bindEffect, defineFx, playEffect, registerBuiltinEffects } from 'motionary/components/fx';
import { defineGestureFx, disableAudio, enableAudio, registerCardClickEffects, registerCursorEffects } from 'motionary/components/effects';
import { registerLightPack } from 'motionary/components/fx-light';
import { registerMusicPack } from 'motionary/components/fx-music';
registerBuiltinEffects();
registerCardClickEffects();
registerCursorEffects();
registerLightPack();
registerMusicPack();
defineFx();
defineGestureFx();
export { bindEffect, playEffect, enableAudio, disableAudio };
