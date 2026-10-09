/** motionary/components/widgets 里本站用到的组件（只引入这些 define，打包时其余组件被 tree-shake 掉）。 */
import { use } from 'motionary/runtime';
import { scroll } from 'motionary/runtime/scroll';
import {
  defineChapterNav, defineDatePicker, defineDisclosure, defineDock, defineFestivalBanner, defineField, defineNativePreview, defineNavMorph, defineOtp,
  definePagination, definePauseAll, definePluginCard, definePresence, definePullCord, defineRouteTransition, defineScrollScene, defineSpatialCard,
  defineStickyWall, defineSwipeDeck, defineSwitch, defineThemeSwitcher, defineUploadProgress, defineVoiceButton,
} from 'motionary/components/widgets';

use(scroll); // <usa-scroll-scene> 与 <usa-plugin-card> 需要先注册 runtime
for (const d of [
  defineRouteTransition, defineNavMorph, definePagination, definePresence, defineDock, definePullCord, defineThemeSwitcher, definePauseAll, defineSwitch,
  defineChapterNav, defineDatePicker, defineDisclosure, defineField, defineOtp, defineUploadProgress, defineVoiceButton, defineStickyWall,
  defineSwipeDeck, defineSpatialCard, defineNativePreview, definePluginCard, defineScrollScene, defineFestivalBanner,
]) d();
