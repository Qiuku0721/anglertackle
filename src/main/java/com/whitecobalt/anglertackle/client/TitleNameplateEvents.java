package com.whitecobalt.anglertackle.client;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.item.Quality;
import com.whitecobalt.anglertackle.title.TitleDefs;
import com.whitecobalt.anglertackle.title.Titles;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.player.Player;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.RenderNameTagEvent;

/**
 * 头顶名牌的称号后缀（`docs/38` §2.1，用户 2026-10-13：
 * **"需要让玩家在他人显示视角里看到名字后有已经佩戴的称号。"**）。
 *
 * <p>显示成 <b>{@code 名字[称号]}</b> —— 与聊天同一套括号、同一个品质色。
 *
 * <h2>为什么是"改名牌内容"而不是"改显示名"</h2>
 * 改显示名（{@code setCustomName}）会把**聊天 / Tab / 名牌三处一起改**
 * （`docs/38` §2 的方案 1 就是因此被否的）。用户要的**只有名牌**，
 * 所以走本事件：**其它两处一个字都不动** ✓。
 *
 * <h2>三条纪律（与 {@code TitleChatEvents} 对齐）</h2>
 * <ol>
 *   <li><b>没戴称号 ⇒ 名牌逐字不变</b>：直接 return，一个字节都不动（纯加法）；</li>
 *   <li><b>认不出的 id ⇒ 不画</b>：客户端没这个模板（版本不一致）时**绝不把语言键
 *       或 {@code %s} 原样画出来** —— 与 {@code TitleSnapshot}/{@code TitleScreen} 同一条判定；</li>
 *   <li><b>出错就放行原版名牌</b>：整个处理器包在 try/catch 里。名牌画不出来，
 *       比"称号不显示"严重得多（这个事件每帧跑，抛一次就整帧崩）。</li>
 * </ol>
 *
 * <p>⚠ 原版名牌自己的规则**全部保留**：蹲下隐藏、距离判断、遮挡、队伍前缀 —— 我们只换内容。
 */
@EventBusSubscriber(modid = AnglersTackle.MOD_ID, value = Dist.CLIENT)
public final class TitleNameplateEvents {

    private TitleNameplateEvents() {
    }

    @SubscribeEvent
    public static void onNameTag(RenderNameTagEvent.CanRender event) {
        try {
            if (!(event.getEntity() instanceof Player player)) {
                return;                       // 只对玩家生效（其它生物/展示框一律放行）
            }
            String id = ClientNameplates.titleOf(player.getUUID());
            if (id == null || id.isEmpty()) {
                return;                       // 没戴 ⇒ 原版名牌照旧 ✓
            }
            if (TitleDefs.byId(id) == null && !TitleDefs.validInstance(id)) {
                return;                       // 认不出 ⇒ 宁可不画（绝不画 %s / 语言键）✓
            }
            Component title = Component.translatable(Titles.nameKey(id), Titles.nameArgs(id))
                    .withStyle(Quality.of(Titles.qualityOf(id)).color());
            // 26.1.2：RenderNameTagEvent.CanRender#getContent() 标了 @Nullable（内容来自
            // getNameTag(entity)，理论上可以没有）。为 null 就干脆不拼 —— 否则 append(null)
            // 会 NPE，掉进下面的 catch 变成**每帧一条**警告（结果一样，但日志会刷爆）。
            Component original = event.getContent();
            if (original == null) {
                return;
            }
            event.setContent(Component.empty()
                    .append(original)
                    .append(Component.literal("["))
                    .append(title)
                    .append(Component.literal("]")));
        } catch (Throwable t) {
            // 称号只是附加信息：绝不让它把名牌（乃至整帧）带崩
            AnglersTackle.LOGGER.warn("[垂纶] 名牌称号后缀失败（已放行原版名牌）：{}", t.toString());
        }
    }
}
