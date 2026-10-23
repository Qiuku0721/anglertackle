package com.whitecobalt.anglertackle.client.screen;

import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;

import java.util.List;

/**
 * **垂纶终端**（统合界面 · 移动终端）：把分散在各物品/入口上的模块收进一个入口
 * （`docs/40` §10、`docs/41` §8 第 5 项）。
 *
 * <h2>它**不做**什么（重要）</h2>
 * 终端**不重写任何面板** —— 它只是一层**路由**：右侧按钮点击后，客户端发一条既有的
 * `/atl xxx`，各模块自己的载荷把界面推回来 ✓（`docs/41` §1"不新造"）。
 *
 * <h2>两类模块（用户 2026-10-15 定案："商店等老柯处的功能不要直接打开对应界面"）</h2>
 * <ul>
 *   <li><b>可直接打开</b>（{@code npc} = false）：右侧出现【打开】按钮，点了才发指令。</li>
 *   <li><b>老柯处的功能</b>（{@code npc} = true，例如商店）：**不给"打开"按钮**，只写清
 *       <b>去哪、怎么操作</b>。理由：那些面板本来就是 NPC 交互的结果，终端直接弹出来会
 *       **绕开 NPC 这条动线**（玩家学不会正确操作），而且与既有入口规则打架 ——
 *       普通右键老柯**不开**商店，那是用户定案过的行为 ✓。</li>
 * </ul>
 *
 * <h2>交互（用户 2026-10-15 第二版要求）</h2>
 * **左键只选中**（不跳转）；**右侧的按钮**才是"真的去做"。↑↓ 选择，回车 = 点右侧按钮
 * （老柯项的回车不发指令 —— 只把步骤留在屏幕上）。
 *
 * <h2>渲染顺序</h2>
 * 背景由 {@code extractBackground} 在 {@code extractRenderState} 之前抽取，这里只画内容，
 * **绝不调** {@code super.extractRenderState()}（本界面没有 widget）。
 * ⚠ 因此**不用原版 Button**，自己画矩形 + 命中测试 ✓。
 */
public class TerminalScreen extends Screen {

    /**
     * 一个模块。
     *
     * @param sub  点【打开】后发送的指令（`/atl <sub>`）；{@code npc} 为 true 时**不使用**
     * @param npc  是不是"老柯处的功能"（true ⇒ 只给指引、不给打开按钮）
     */
    private record Module(String sub, String nameKey, boolean npc) {
    }

    // ⚠ 只列无门槛的子指令（OP 的 coins/repair/stage/resetstock 一律不许列）。
    private static final List<Module> MODULES = List.of(
            new Module("quest", "gui.anglertackle.term.quest", false),
            new Module("codex", "gui.anglertackle.term.codex", false),
            new Module("mail", "gui.anglertackle.term.mail", false),
            new Module("ach", "gui.anglertackle.term.ach", false),
            new Module("title", "gui.anglertackle.term.title", false),
            new Module("shop", "gui.anglertackle.term.shop", true),
            new Module("rank", "gui.anglertackle.term.rank", false),
            new Module("league", "gui.anglertackle.term.league", false),
            new Module("contest", "gui.anglertackle.term.contest", false));

    private static final int DESIGN_W = 470;
    private static final int DESIGN_H = 224;
    private static final int ROW_H = 14;
    private static final int COLOR_BG = 0xF0101010;
    private static final int COLOR_FRAME = 0xFF3A3A3A;
    private static final int COLOR_TITLE = 0xFFE8C56A;
    private static final int COLOR_TEXT = 0xFFD0D0D0;
    private static final int COLOR_DIM = 0xFF808080;
    private static final int COLOR_SELECT = 0x40FFFFFF;
    private static final int COLOR_BTN = 0xFF3C5A3C;
    private static final int COLOR_BTN_HOVER = 0xFF5C8A5C;
    private static final int COLOR_BTN_TEXT = 0xFFEFFFE8;

    private int panelX;
    private int panelY;
    private int panelW;
    private int panelH;
    private int selected;

    /** 右侧【打开】按钮的命中框（每帧算一次，mouseClicked 用它）—— -1 = 本项没有按钮。 */
    private int btnX = -1;
    private int btnY = -1;
    private int btnW;
    private final int btnH = 16;

    public TerminalScreen() {
        super(Component.translatable("gui.anglertackle.term.title"));
    }

    @Override
    protected void init() {
        this.panelW = UiLayout.panelW(this.width, DESIGN_W, 240);
        this.panelH = UiLayout.panelH(this.height, DESIGN_H, 120);
        this.panelX = (this.width - panelW) / 2;
        this.panelY = (this.height - panelH) / 2;
    }

    private int leftX() {
        return panelX + 8;
    }

    private int rightX() {
        return leftX() + 150 + 12;
    }

    private int rightW() {
        return panelX + panelW - 8 - rightX();
    }

    private int top() {
        return panelY + 26;
    }

    private int bottom() {
        return panelY + panelH - 16;
    }

    private Module current() {
        return MODULES.get(Math.max(0, Math.min(selected, MODULES.size() - 1)));
    }

    @Override
    public void extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float partialTick) {
        g.fill(panelX, panelY, panelX + panelW, panelY + panelH, COLOR_BG);
        g.fill(panelX, panelY, panelX + panelW, panelY + 1, COLOR_FRAME);
        g.fill(panelX, panelY + panelH - 1, panelX + panelW, panelY + panelH, COLOR_FRAME);
        g.fill(panelX, panelY, panelX + 1, panelY + panelH, COLOR_FRAME);
        g.fill(panelX + panelW - 1, panelY, panelX + panelW, panelY + panelH, COLOR_FRAME);
        g.text(this.font, this.title, panelX + 8, panelY + 6, COLOR_TITLE, false);

        // ── 左栏：模块列表。**点击只选中**，不跳转 ──
        for (int i = 0; i < MODULES.size(); i++) {
            int y = top() + i * ROW_H;
            boolean in = mouseX >= leftX() - 3 && mouseX < leftX() + 150
                    && mouseY >= y - 1 && mouseY < y + ROW_H - 1;
            if (i == selected || in) {
                g.fill(leftX() - 3, y - 1, leftX() + 150, y + ROW_H - 1, COLOR_SELECT);
            }
            g.text(this.font, Component.translatable(MODULES.get(i).nameKey()).getString(),
                    leftX(), y, i == selected ? COLOR_TITLE : COLOR_TEXT, false);
        }

        // ── 右栏：说明 + （非老柯项）【打开】按钮 / （老柯项）操作步骤 ──
        Module sel = current();
        int rx = rightX();
        int rw = rightW();
        btnX = -1;
        g.text(this.font, UiLayout.fitText(Component.translatable(sel.nameKey()).getString(), rw),
                rx, top(), COLOR_TITLE, false);
        int y = top() + ROW_H + 4;

        if (sel.npc()) {
            g.text(this.font, Component.translatable("gui.anglertackle.term.npc_header").getString(),
                    rx, y, COLOR_TITLE, false);
            y += 12;
            for (String line : UiLayout.wrapCjk(
                    Component.translatable(sel.nameKey() + ".steps").getString(), rw)) {
                if (y > bottom() - 12) {
                    break;
                }
                g.text(this.font, line, rx, y, COLOR_TEXT, false);
                y += 11;
            }
        } else {
            for (String line : UiLayout.wrapCjk(
                    Component.translatable(sel.nameKey() + ".desc").getString(), rw)) {
                if (y > bottom() - 36) {
                    break;
                }
                g.text(this.font, line, rx, y, COLOR_TEXT, false);
                y += 11;
            }
            String label = Component.translatable("gui.anglertackle.term.open").getString();
            btnW = this.font.width(label) + 18;
            btnX = rx;
            btnY = bottom() - btnH - 16;
            boolean hover = mouseX >= btnX && mouseX < btnX + btnW
                    && mouseY >= btnY && mouseY < btnY + btnH;
            g.fill(btnX, btnY, btnX + btnW, btnY + btnH, hover ? COLOR_BTN_HOVER : COLOR_BTN);
            g.fill(btnX, btnY, btnX + btnW, btnY + 1, COLOR_FRAME);
            g.fill(btnX, btnY + btnH - 1, btnX + btnW, btnY + btnH, COLOR_FRAME);
            g.text(this.font, label, btnX + 9, btnY + 4, COLOR_BTN_TEXT, false);
        }

        g.text(this.font, UiLayout.fitText(
                        Component.translatable("gui.anglertackle.term.hint").getString(), panelW - 16),
                panelX + 8, panelY + panelH - 12, COLOR_DIM, false);
    }

    /** 只有**非老柯**模块才真的发指令（老柯项由玩家自己走过去操作）✓。 */
    private void activateCurrent() {
        Module sel = current();
        if (sel.npc() || this.minecraft == null || this.minecraft.player == null) {
            return;
        }
        this.minecraft.player.connection.sendCommand("atl " + sel.sub());
    }

    @Override
    public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
        double mouseX = event.x();
        double mouseY = event.y();
        int button = event.button();
        // 左栏：只选中（不跳转）
        for (int i = 0; i < MODULES.size(); i++) {
            int y = top() + i * ROW_H;
            if (mouseX >= leftX() - 3 && mouseX < leftX() + 150
                    && mouseY >= y - 1 && mouseY < y + ROW_H - 1) {
                selected = i;
                return true;
            }
        }
        // 右侧按钮：这一下才"真的去做"
        if (btnX >= 0 && mouseX >= btnX && mouseX < btnX + btnW
                && mouseY >= btnY && mouseY < btnY + btnH) {
            activateCurrent();
            return true;
        }
        return super.mouseClicked(event, doubleClick);
    }

    @Override
    public boolean keyPressed(KeyEvent event) {
        int keyCode = event.key();
        if (keyCode == 265 && selected > 0) {                     // ↑
            selected--;
            return true;
        }
        if (keyCode == 264 && selected < MODULES.size() - 1) {    // ↓
            selected++;
            return true;
        }
        if (keyCode == 257 || keyCode == 335) {                   // 回车 = 点右侧按钮
            activateCurrent();
            return true;
        }
        return super.keyPressed(event);
    }

    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double scrollX, double scrollY) {
        selected = Math.max(0, Math.min(MODULES.size() - 1, selected - (int) Math.signum(scrollY)));
        return true;
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }
}
