package com.whitecobalt.anglertackle.client.hud;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.client.ClientCoins;
import com.whitecobalt.anglertackle.client.ClientLeaguePoints;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.network.chat.Component;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.RegisterGuiLayersEvent;
import net.neoforged.neoforge.client.gui.VanillaGuiLayers;

/**
 * 鱼币数据面板 —— 常驻左上角的一个小牌子。
 *
 * <h2>为什么是常驻，而不是只在钓鱼时显示</h2>
 * 用户的原话是"鱼币要单独一个数据面板"，而反馈是"看不到鱼币显示"。
 * 只在钓鱼流程里画的话，玩家在商店/整理背包/和别人比余额时都看不到自己的钱，
 * 那就不叫面板了。所以这里**一直显示**。
 *
 * <p>两处例外（都必须有）：
 * <ul>
 *   <li>{@code hideGui}（F1 隐藏界面）—— 玩家明确要求清屏时必须跟着藏；</li>
 *   <li>F3 调试屏打开时 —— 那一片正好在左上角，不藏的话两段字会叠在一起，
 *       两边都看不清。</li>
 * </ul>
 *
 * <h2>为什么没同步到就什么都不画</h2>
 * {@link ClientCoins} 的初始值是 -1（未知）而不是 0。0 是合法余额，
 * 混在一起的话刚进世界会先闪一个假的"0 ¤"出来，看起来像钱丢了。
 *
 * <h2>第二行：联赛积分（2026-10-13 加）</h2>
 * 用户反馈原话是"积分我没看到在哪显示，**不像鱼币那样清晰明了**"。
 * 所以联赛积分**并进同一块牌子**当第二行，而不是另开一块 ——
 * 另开会变成左上角两块黑底叠着，观感更乱；同一块牌子里"上面鱼币、下面积分"
 * 也更符合"这是两个钱包"的直觉。
 *
 * <p>取值同样走"未知就不画"：{@link ClientLeaguePoints} 没同步到时**整行不画**、
 * 牌子高度退回一行（不会留一条空白，也不会闪一个假的 0）。
 */
@EventBusSubscriber(modid = AnglersTackle.MOD_ID, value = Dist.CLIENT)
public final class CoinsHud {

    /** 相对左上角的边距。 */
    private static final int MARGIN_X = 6;
    private static final int MARGIN_Y = 6;
    /** 底色内边距。 */
    private static final int PAD_X = 4;
    private static final int PAD_Y = 2;

    private static final int BG = 0x90000000;        // 半透明黑底
    private static final int COLOR = 0xFFFFD050;     // 金 —— 和标题/强调同色
    private static final int GLYPH = 0xFFB0B0B0;     // 「¤」用次要色，数字才是主角
    /**
     * 联赛积分那一行的颜色（`docs/39`，2026-10-13 加）。
     *
     * <p>**刻意与鱼币的金不同色**：两个钱包挤在同一块牌子上，颜色一样的话玩家会以为
     * 那是同一个数字的两种写法。淡蓝一眼分得开，也不和警告用的红/黄撞。
     */
    private static final int LEAGUE_COLOR = 0xFF9FD8FF;

    private CoinsHud() {
    }

    @SubscribeEvent
    public static void register(RegisterGuiLayersEvent event) {
        // 挂在经验条之上：这样它和原版 HUD 的层级关系是明确的，
        // 不会出现"被血量盖住"这种取决于注册顺序的玄学。
        event.registerAbove(VanillaGuiLayers.EXPERIENCE_BAR,
                net.minecraft.resources.Identifier.fromNamespaceAndPath(
                        AnglersTackle.MOD_ID, "coins_hud"),
                CoinsHud::render);
    }

    private static void render(GuiGraphics graphics, net.minecraft.client.DeltaTracker delta) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null || mc.options.hideGui) {
            return;
        }
        if (mc.getDebugOverlay() != null && mc.getDebugOverlay().showDebugScreen()) {
            return;   // F3 的左上角文字会叠上来
        }
        if (!ClientCoins.known()) {
            return;   // 还没同步过，宁可什么都不画也不要闪一个假的 0
        }

        var font = mc.font;
        String num = format(ClientCoins.coins());
        // 第二行：联赛积分（用户 2026-10-13 反馈"积分看不到，不像鱼币那样清晰明了"）。
        // 未同步到就只画鱼币那一行 —— 牌子的高度随之变化，不会留一行空白。
        boolean showLeague = ClientLeaguePoints.known();
        String leagueLabel = Component.translatable("hud.anglertackle.league_points").getString();
        String leagueNum = format(ClientLeaguePoints.points());

        int coinW = font.width(num) + font.width("¤ ");
        int leagueW = font.width(leagueLabel + " ") + font.width(leagueNum);
        int rowH = font.lineHeight;
        int rows = showLeague ? 2 : 1;

        int w = showLeague ? Math.max(coinW, leagueW) : coinW;
        int h = rowH * rows;

        int x = MARGIN_X;
        int y = MARGIN_Y;
        graphics.fill(x, y, x + w + PAD_X * 2, y + h + PAD_Y * 2, BG);
        graphics.drawString(font, "¤", x + PAD_X, y + PAD_Y, GLYPH, false);
        graphics.drawString(font, num, x + PAD_X + font.width("¤ "), y + PAD_Y, COLOR, false);
        if (showLeague) {
            int y2 = y + PAD_Y + rowH;
            graphics.drawString(font, leagueLabel, x + PAD_X, y2, GLYPH, false);
            graphics.drawString(font, leagueNum,
                    x + PAD_X + font.width(leagueLabel + " "), y2, LEAGUE_COLOR, false);
        }
    }

    /** 千分位。数字大了不加分隔符根本数不清有几位。 */
    private static String format(long v) {
        return String.format("%,d", v);
    }
}
