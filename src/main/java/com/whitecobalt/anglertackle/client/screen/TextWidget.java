package com.whitecobalt.anglertackle.client.screen;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.network.chat.Component;
import net.minecraft.util.Mth;

/**
 * 一行文字 Widget。
 *
 * <p><b>为什么要做成 Widget 而不是 {@code graphics.drawString()}</b>：
 * 在用户的环境里（同时装了 TACZ / 森洛物语 / GeckoLib / JEI 等），
 * 自绘 Screen 上用 {@code drawString} 画的文字会糊，而原版 Button 的文字是清晰的。
 * Button 与普通绘制唯一的区别就是**走 Widget 渲染路径**（在 {@code super.render} 里统一提交）。
 * 所以这里把每一行文字都做成 Widget——用和按钮完全相同的路径画，
 * 渲染结果就一样清晰。
 *
 * <p>它不响应点击（{@link #mouseClicked} 返回 false），纯展示。
 */
public class TextWidget extends AbstractWidget {

    /** 文字颜色（ARGB）。 */
    private int color;
    /** 是否绘制阴影（深色底上开启更清楚）。 */
    private final boolean shadow;
    /** 文字相对控件左上角的偏移。 */
    private final int offsetX;
    private final int offsetY;

    public TextWidget(int x, int y, int width, int height, String text, int color) {
        this(x, y, width, height, text, color, true, 0, 0);
    }

    public TextWidget(int x, int y, int width, int height, String text, int color,
                      boolean shadow, int offsetX, int offsetY) {
        super(x, y, width, height, Component.literal(text == null ? "" : text));
        this.color = color;
        this.shadow = shadow;
        this.offsetX = offsetX;
        this.offsetY = offsetY;
        this.active = false;   // 不参与交互
    }

    /** 更新显示的文字（同一行内容变化时用，避免重建整个界面）。 */
    public void setText(String text) {
        this.setMessage(Component.literal(text == null ? "" : text));
    }

    public void setColor(int color) {
        this.color = color;
    }

    @Override
    protected void extractWidgetRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float partialTick) {
        var font = Minecraft.getInstance().font;
        String text = getMessage().getString();
        if (text.isEmpty()) {
            return;
        }
        // 垂直居中，水平按偏移
        int ty = getY() + offsetY + Math.max(0, (height - 8) / 2);
        g.text(font, text, getX() + offsetX, ty, color, shadow);
    }

    /** 纯展示控件：不吞点击事件。 */
    @Override
    public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
        return false;
    }

    @Override
    protected void updateWidgetNarration(NarrationElementOutput output) {
        // 纯展示，不需要旁白
    }

    /** 便捷：按给定文字自动算宽度。 */
    public static TextWidget of(int x, int y, String text, int color) {
        int w = Mth.clamp(Minecraft.getInstance().font.width(text) + 2, 8, 400);
        return new TextWidget(x, y, w, 12, text, color);
    }
}
