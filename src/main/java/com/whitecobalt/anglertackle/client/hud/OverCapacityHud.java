package com.whitecobalt.anglertackle.client.hud;

import com.whitecobalt.anglertackle.AnglersTackle;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.RegisterGuiLayersEvent;
import net.neoforged.neoforge.client.gui.VanillaGuiLayers;

/**
 * 超承重警告 —— 屏幕正中偏上的红字，外加一条竿耐久条。
 *
 * <h2>为什么需要这个（用户反馈）</h2>
 * 原话："一上鱼玩家就想拉，一拉超重提示就没，不明显。"
 *
 * <p>根因是**提示只发了一次，而且是走动作栏**：咬钩那一刻弹一条
 * {@code displayClientMessage(..., true)}，而动作栏是**共用**的 ——
 * 玩家一开始收线，别的消息（上鱼、张力、疲劳提示）就把它顶掉了。
 * 玩家根本来不及看见"这条鱼超重了"。
 *
 * <p>所以这里把它搬到 HUD 上：只要 {@code overCapacity} 还成立就**一直画**，
 * 画到鱼跑了或者竿断了为止。动作栏会被覆盖，HUD 不会。
 *
 * <h2>为什么要连竿耐久一起画</h2>
 * "看不清在烧"等于没有惩罚 —— 玩家只会觉得"竿莫名其妙没了"。
 * 所以超重期间额外画一条醒目的耐久条，让"血在往下掉"这件事无法忽视。
 */
@EventBusSubscriber(modid = AnglersTackle.MOD_ID, value = Dist.CLIENT)
public final class OverCapacityHud {

    /** 文字的颜色（正红），以及耐久条的底色/填充色。 */
    private static final int RED = 0xFFFF4040;
    private static final int BAR_BG = 0xC0000000;
    private static final int BAR_FILL = 0xFFFF4040;
    private static final int BAR_W = 180;
    private static final int BAR_H = 6;

    private OverCapacityHud() {
    }

    @SubscribeEvent
    public static void register(RegisterGuiLayersEvent event) {
        event.registerAbove(VanillaGuiLayers.EXPERIENCE_BAR,
                net.minecraft.resources.Identifier.fromNamespaceAndPath(
                        AnglersTackle.MOD_ID, "over_capacity_hud"),
                OverCapacityHud::render);
    }

    private static void render(GuiGraphics graphics, net.minecraft.client.DeltaTracker delta) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null || mc.options.hideGui) {
            return;
        }
        var state = com.whitecobalt.anglertackle.client.ClientFishingState.get();
        if (!state.overCapacity()) {
            return;
        }

        var font = mc.font;
        int screenW = graphics.guiWidth();
        int screenH = graphics.guiHeight();

        // 警告文字：屏幕正中偏上，和张力条/提竿提示都不抢位置
        String warn = net.minecraft.network.chat.Component
                .translatable("hud.anglertackle.over_capacity").getString();
        int w = font.width(warn);
        int y = screenH / 2 - 70;
        // 描边式画两遍：先黑后红，红字在深色水面/天空上都读得清
        graphics.drawString(font, warn, (screenW - w) / 2 + 1, y + 1, 0xFF000000, false);
        graphics.drawString(font, warn, (screenW - w) / 2, y, RED, false);

        // 竿耐久条：画在警告下面，宽度随剩余耐久收缩
        float left = state.rodDurabilityRatio();
        if (left >= 0f) {
            int bx = (screenW - BAR_W) / 2;
            int by = y + font.lineHeight + 4;
            graphics.fill(bx - 1, by - 1, bx + BAR_W + 1, by + BAR_H + 1, BAR_BG);
            int fill = (int) (BAR_W * left);
            if (fill > 0) {
                graphics.fill(bx, by, bx + fill, by + BAR_H, BAR_FILL);
            }
        }
    }
}
