import type { Context } from '@koishijs/client'
import TwitterConfigNavLoader from './TwitterConfigNavLoader.vue'

export default (ctx: Context) => {
  ctx.slot({
    type: 'plugin-details',
    component: TwitterConfigNavLoader,
    order: -998,
  })
}
