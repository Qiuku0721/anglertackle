package com.whitecobalt.anglertackle.client.screen;

import com.whitecobalt.anglertackle.guide.GuideBookItem;
import com.whitecobalt.anglertackle.network.GuidePayload;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * 教程书界面。
 *
 * <p><b>文字全部用 {@link TextWidget} 渲染</b>（与按钮同一条渲染路径），
 * 因为实测在本环境里 {@code graphics.drawString} 直接画出来的文字是糊的。
 * 只有面板底色用 {@code fill} 画——底色糊一点无所谓，字清楚就行。
 *
 * <p>左栏目录（按钮，点击切章），右栏正文（TextWidget，&lt; &gt; 翻页）。
 *
 * <h2>这个界面修过的三个"补了内容也看不到"的问题</h2>
 * 它们都属于**编译能过、游戏能跑、只是玩家看不到东西**的类型，
 * 所以每一条都在 {@code tools/check-guide.js} 里钉死了：
 *
 * <ol>
 *   <li><b>目录只画 8 个按钮、标题按 8 个字截断</b>（原 {@code i < 8} + {@code trim(label, 8)}）。
 *       章节一超过 8 个，第 9 章之后**在界面上根本不存在**；
 *       而中文标题 8 个字只够写"三分钟学会钓鱼"，玩家在目录里认不出是哪一章。
 *       现在：目录按 {@link #tocRows} 行分页（多出来的章用 ↑↓ 翻），
 *       标题按**像素宽度**裁（能塞多少塞多少），而不是按固定字数。</li>
 *   <li><b>正文超页静默丢行</b>（原 {@code if (y > top + panelH - 30) break;}）。
 *       {@code break} 掉的行**永远不会显示，界面上也没有任何提示** ——
 *       看起来就是"教程写到这儿就结束了"。补内容时最容易被它坑：
 *       你在 JSON 里写满了 20 行，玩家只看到 13 行，而且没人会知道少了 7 行。
 *       现在：先按 {@link #rowsPerPage} 把一页切成若干**显示页**，
 *       翻页按钮走得完（和 {@link CodexScreen} 同一个思路）。</li>
 *   <li><b>单行不换行，直接画到面板外</b>。一行超过 {@link #bodyW} 就糊到面板边框上、
 *       和右侧留白重叠。现在：超宽行按像素**折行**（{@link #wrapLine}），
 *       折出来的行数照样参与分页计算，一个字都不会丢。</li>
 * </ol>
 *
 * <p><b>为什么"折行 + 自动分页"要做，而且仍然要求文案自己排好</b>：
 * 界面上这两层是**兜底**（整合包作者手改数据包、翻译成更长的英文时保命），
 * 出厂的文案由 {@code check-guide.js} 静态断言"每页 ≤ {@link #rowsPerPage} 行、
 * 每行 ≤ {@link #bodyW} 像素" —— 这样才能保证"每页正好一屏"的阅读节奏，
 * 而不是靠运行时切得七零八落。两层各管一件事，缺一层都会退化成"内容看不全"。
 */
public class GuideScreen extends Screen {

    // ---------------------------------------------------------------- 尺寸
    private static final int PANEL_W = 400;
    private static final int PANEL_H = 224;
    /** 左栏目录宽度。 */
    private static final int TOC_W = 120;
    /** TextWidget 的控件高度（只影响 Widget 自身，不影响行距）。 */
    private static final int LINE_H = 11;
    /** 行距：比字高（8px + 阴影）多 2px，否则两行糊成一块。 */
    private static final int LINE_STEP = LINE_H + 2;

    /** 正文左边界（相对面板左沿）：目录栏 + 间距。 */
    private static final int BODY_X = TOC_W + 14;
    /** 正文右侧留白：不留的话超宽行会顶到面板边框上。 */
    private static final int BODY_RIGHT_PAD = 8;
    /** 正文可用像素宽度。{@link #wrapLine} 和检查脚本都以它为准。 */
    private static final int BODY_W = PANEL_W - BODY_X - BODY_RIGHT_PAD;
    /** 正文首行相对面板顶的偏移（上面是章节标题）。 */
    private static final int BODY_TOP = 30;
    /** 底部保留区高度（翻页按钮 + 页码）。 */
    private static final int FOOTER_H = 24;

    /**
     * 每屏正文行数 —— <b>算出来的，不是写死的</b>。
     *
     * <p>写死一个数字的话，以后把面板改高一点就会变回"最后几行被裁掉"，
     * 而那正是这个类上面刚说过的坑（{@code CodexScreen} 的
     * {@code rowsPerPage} 是同一个理由）。
     */
    private static final int ROWS_PER_PAGE = (PANEL_H - FOOTER_H - BODY_TOP) / LINE_STEP;

    // ---------------------------------------------------------------- 目录列
    /** 目录第一行相对面板顶的偏移。 */
    private static final int TOC_TOP = 26;
    /** 目录按钮高度 / 行距。20/22 时第 8 个按钮会压到翻页按钮上，所以收紧到 18/20。 */
    private static final int TOC_BTN_H = 18;
    private static final int TOC_STEP = TOC_BTN_H + 2;
    /** 目录最多画到哪（再往下是翻页按钮）。 */
    private static final int TOC_BOTTOM = PANEL_H - 34;
    /** 每屏目录条数。8 条正好装下出货的 8 章，多加的章自动翻页。 */
    private static final int TOC_ROWS = (TOC_BOTTOM - TOC_TOP) / TOC_STEP;

    // ---------------------------------------------------------------- 自适应（本次实际尺寸）
    //
    // 上面那些常量是**设计尺寸**（布局按它数；窗口够大时用的就是它）。
    // 真正画的时候一律用下面这几个字段 —— 在 init() 里按窗口现算。
    // 见 UiLayout 的类注释：用户 2026-10-02 报"图鉴装不下"之后，四个界面一起改成自适应。
    private int panelW = PANEL_W;
    private int panelH = PANEL_H;
    /** 正文左边界（实际面板内坐标）。 */
    private int bodyX = BODY_X;
    /** 正文可用像素宽度（折行与分页都以它为准）。 */
    private int bodyW = BODY_W;
    /** 每屏正文行数。 */
    private int rowsPerPage = ROWS_PER_PAGE;
    /** 目录栏宽度 / 每屏目录条数 / 目录底界。 */
    private int tocW = TOC_W;
    private int tocRows = TOC_ROWS;
    private int tocBottom = TOC_BOTTOM;
    /** 面板宽度下限（比这还窄就没法看了）。 */
    private static final int MIN_W = 240;

    // ---------------------------------------------------------------- 配色（与 CodexScreen 同源）
    private static final int C_TITLE = 0xFFFFD050;
    private static final int C_LABEL = 0xFF8FCBF5;
    private static final int C_TEXT = 0xFFE8E8E8;
    private static final int C_DIM = 0xFFB0B0B0;
    private static final int C_PANEL = 0xFF243028;
    private static final int C_SHADOW = 0xF0000000;
    private static final int C_LINE = 0xFF5A6A60;

    private GuidePayload data;
    /** 当前章的**显示页**序号（一页逻辑内容可能被切成多个显示页）。 */
    private int page;
    /** 目录分页的第一章序号（章数 ≤ {@link #tocRows} 时恒为 0）。 */
    private int tocTop;
    private int left;
    private int top;

    private final List<Button> buttons = new ArrayList<>();
    private final List<TextWidget> textWidgets = new ArrayList<>();
    /** 当前章的显示页（{@link #rebuild()} 里算好，翻页时直接取）。 */
    private List<Slice> slices = List.of();

    /** 一个显示页：若干行文本 + 是不是"上一屏内容的续页"。 */
    private record Slice(List<String> lines, boolean continued) {
    }

    public GuideScreen(GuidePayload data) {
        super(Component.translatable("item.anglertackle.guide_book"));
        this.data = data;
    }

    /**
     * 服务端回了新章节。
     *
     * <h2>两条纪律（都被用户实测打回过，别再犯）</h2>
     * <ol>
     *   <li><b>只归零"正文页码"，绝不动"目录页码"</b>（{@link #tocTop}）。
     *       用户 2026-10-16 连报两次"点左侧目录会强制回到第一页"——
     *       第一次我以为是正文翻页（改了 page 的归零条件），第二次才看清：
     *       他说的是**左边那栏目录自己跳回第 1 页**（18 章、一屏只放 8 行 ⇒ 目录有 3 页）。
     *       我原来在换章时把 {@code page} 和 {@code tocTop} 一起归零了 ⇒
     *       玩家在第 2 页目录里点第 10 章，目录立刻弹回第 1 页，他没法接着往下点 ✗。
     *       现在目录页码**只由那两个 ↑/↓ 键动**（见 {@link #rebuildToc}，那里有越界夹取）。</li>
     *   <li><b>换章要把正文回到该章第 1 页</b>：否则会停在上一章的第 3 页，
     *       而新章可能只有 1 页 ⇒ 观感是"换章后一片空白"。</li>
     * </ol>
     * 判据是服务端回的章节序号：只有它变了才算"换章"（同一章的刷新留在原地）。
     */
    public void acceptNewChapter(GuidePayload payload) {
        boolean chapterChanged = payload.index() != this.data.index();
        this.data = payload;
        if (chapterChanged) {
            this.page = 0;          // ⚠ 只动正文页码 —— tocTop 一个字节都不许碰（见上面的纪律 1）
        }
        if (this.minecraft != null) {
            // page 越界由 rebuild() 自己收口（章更短时会被夹回最后一页）
            rebuild();
        }
    }

    @Override
    protected void init() {
        // 面板必须装得进窗口（窗口是 GUI 缩放折算后的逻辑像素，见 UiLayout 的类注释）
        panelW = UiLayout.panelW(this.width, PANEL_W, MIN_W);
        panelH = UiLayout.panelH(this.height, PANEL_H, BODY_TOP + FOOTER_H + LINE_STEP);
        // 目录 / 正文的分界按面板宽度等比压缩（面板等于设计宽度时就是原值）
        bodyX = UiLayout.fitX(BODY_X, PANEL_W, panelW, 4);
        bodyW = Math.max(40, panelW - bodyX - BODY_RIGHT_PAD);
        rowsPerPage = UiLayout.rows(panelH, BODY_TOP, FOOTER_H, LINE_STEP);
        tocW = Math.max(50, bodyX - 14);
        tocBottom = panelH - 34;
        tocRows = Math.max(1, (tocBottom - TOC_TOP) / TOC_STEP);
        this.left = (this.width - panelW) / 2;
        this.top = (this.height - panelH) / 2;
        // 目录翻到**当前章所在**的那一页 —— 打开书时"你在第 12 章，目录却停在第 1 页"
        // 同样会让人以为目录坏了。这里只在"还没翻过目录"（tocTop == 0）时定位一次，
        // 之后玩家用 ↑/↓ 翻到哪页就是哪页（换章也不许动它，见 acceptNewChapter 的纪律 1）。
        if (tocTop == 0 && tocRows > 0) {
            tocTop = Math.min(tocPages(), data.index() / tocRows);
        }
        rebuild();
    }

    /** 目录一共几页（tocRows 由窗口尺寸决定，所以每帧现算）。 */
    private int tocPages() {
        int rows = Math.max(1, tocRows);
        return Math.max(1, (data.titles().size() + rows - 1) / rows);
    }

    // ------------------------------------------------------------------ 重建
    /**
     * 整屏重建：清掉全部控件再重画。
     *
     * <p><b>为什么不做"只重建变化的那一半"</b>：目录翻页会新增一条目录页码文字，
     * 正文翻页不该把它清掉，于是"谁负责清、清到哪"就成了一份要背下来的约定 ——
     * 这种约定第一次改动就会错（早期版本正是 {@code rebuildToc} 与
     * {@code rebuildBody} 各自清各自的，正文那段会把目录文字一起清掉）。
     * 控件总量只有几十个，全量重建的代价可以忽略，换来的是没有隐含状态。
     */
    private void rebuild() {
        for (Button b : buttons) {
            this.removeWidget(b);
        }
        buttons.clear();
        for (TextWidget w : textWidgets) {
            this.removeWidget(w);
        }
        textWidgets.clear();

        // 分页先算：目录里的"下一页"按钮要用 slices.size() 判边界，
        // 放在 rebuildToc 之后算的话，第一次点"下一页"读到的是上一次的页数。
        slices = buildSlices(data.pages());
        if (page > slices.size() - 1) {
            page = slices.size() - 1;
        }
        if (page < 0) {
            page = 0;
        }

        rebuildToc();
        rebuildBody();
    }

    /** 正文：章节标题 + 当前显示页 + 页码。每行一个 TextWidget。 */
    private void rebuildBody() {
        int textX = left + bodyX;
        addText(textX, top + 8, data.chapterTitle(), C_TITLE);

        Slice slice = slices.get(page);

        int y = top + BODY_TOP;
        for (String line : slice.lines()) {
            if (!line.isEmpty()) {
                addText(textX, y, line, bodyColor(line));
            }
            y += LINE_STEP;
        }

        // 页码放在正文翻页按钮之间：显示页数，续页明确标出来，
        // 否则玩家会以为"这一页的话怎么没说完"。
        String label = (page + 1) + " / " + slices.size() + (slice.continued() ? "（续）" : "");
        addText(left + panelW / 2 + 20, top + panelH - 20, label, C_DIM);
    }

    /** 目录：章节按钮（分页）+ 正文翻页按钮 + 目录翻页按钮。 */
    private void rebuildToc() {
        List<String> titles = data.titles();
        int tocPages = tocPages();   // 与 init() 用同一个口径（别处再算一遍就会漂）
        if (tocTop > tocPages - 1) {
            tocTop = tocPages - 1;
        }
        if (tocTop < 0) {
            tocTop = 0;
        }
        int from = tocTop * tocRows;
        int to = Math.min(titles.size(), from + tocRows);
        for (int i = from; i < to; i++) {
            final int index = i;
            // 标签按像素裁，不按固定字数：中文标题 8 个字（72px）在 112px 的按钮里
            // 还剩一半空间，白白丢掉一半信息量。
            String label = fit(tocLabel(titles.get(i)), tocW - 12);
            Button b = Button.builder(Component.literal(label), btn -> {
                // ⚠⚠ 2026-10-16 用户第二次报同一个症状（"翻到第 3 页后再点【当前这一章】还会跳回第 1 页"）。
                //   上一版只在**收到服务端回包时**比较章节序号（acceptNewChapter 里），
                //   逻辑上已经不会跳 —— 但它把"点当前章"这条路径**交给了一次网络往返**：
                //   只要回包的 index 和屏幕里这份 data 的 index 有一丁点不一致（或干脆换了新屏幕实例），
                //   页码就又被归零。玩家看到的就是"照样跳回第一页"。
                //   ⇒ 现在在**事件入口**直接挡掉：点的是当前这一章 ⇒ 什么都不做。
                //     不发包、不重建、不动 page ⇒ 页码不可能变。判据只有一处真源（当前显示的那一章）。
                if (index == data.index()) {
                    return;
                }
                GuideBookItem.requestChapter(index);
            }).bounds(left + 4, top + TOC_TOP + (i - from) * TOC_STEP, tocW - 8, TOC_BTN_H).build();
            // 当前章标出来并**置灰不可点** —— 与"点了什么都不做"是同一件事的两种表达：
            // 按钮看起来能点、点了却没反应，比"明显不可点"更让人以为界面坏了。
            if (index == data.index()) {
                b.active = false;
            }
            addRenderableWidget(b);
            buttons.add(b);
        }

        // 目录翻页：章数超过一屏时才出现（出货内容正好 8 章，不会看到这两个键）
        if (tocPages > 1) {
            Button up = Button.builder(Component.literal("↑"), b -> {
                if (tocTop > 0) {
                    tocTop--;
                    rebuild();
                }
            }).bounds(left + 4, top + panelH - 24, 20, 18).build();
            addRenderableWidget(up);
            buttons.add(up);

            Button down = Button.builder(Component.literal("↓"), b -> {
                if (tocTop < tocPages - 1) {
                    tocTop++;
                    rebuild();
                }
            }).bounds(left + 28, top + panelH - 24, 20, 18).build();
            addRenderableWidget(down);
            buttons.add(down);

            addText(left + 54, top + panelH - 20, (tocTop + 1) + "/" + tocPages, C_DIM);
        }

        Button prev = Button.builder(Component.literal("<"), b -> {
            if (page > 0) {
                page--;
                rebuild();
            }
        }).bounds(left + bodyX, top + panelH - 24, 26, 18).build();
        addRenderableWidget(prev);
        buttons.add(prev);

        Button next = Button.builder(Component.literal(">"), b -> {
            if (page < slices.size() - 1) {
                page++;
                rebuild();
            }
        }).bounds(left + panelW - 40, top + panelH - 24, 26, 18).build();
        addRenderableWidget(next);
        buttons.add(next);
    }

    // ------------------------------------------------------------------ 分页
    /**
     * 把章节的逻辑页摊成**显示页**：先折行，再按 {@link #rowsPerPage} 切窗口。
     *
     * <p>顺序不能反：先切页再折行的话，折出来的行会把这一屏挤爆，
     * 于是又回到"装不下怎么办"那个问题上了。
     *
     * <p>{@code to} 用 {@link Math#min} 收口，这是"一行都不会丢"的另一半保证 ——
     * 写死 {@code from + rowsPerPage} 在最后一页会越界，写死总行数又会画出面板外。
     */
    private List<Slice> buildSlices(List<List<String>> pages) {
        List<Slice> out = new ArrayList<>();
        for (List<String> page : pages) {
            List<String> flat = new ArrayList<>();
            for (String line : page) {
                flat.addAll(wrapLine(line, bodyW));
            }
            if (flat.isEmpty()) {
                flat.add("");
            }
            for (int i = 0; i < flat.size(); i += rowsPerPage) {
                int to = Math.min(flat.size(), i + rowsPerPage);
                out.add(new Slice(List.copyOf(flat.subList(i, to)), i > 0));
            }
        }
        if (out.isEmpty()) {
            // 一章一页都没有（数据包被改坏 / 翻译文件缺页）：给一个空显示页，
            // 让页码显示"1 / 1"而不是"1 / 0"。
            out.add(new Slice(List.of(), false));
        }
        return out;
    }

    /**
     * 按像素宽度折行。
     *
     * <p>用 {@code font.width()} 实测而不是"按字数估"：同一条文案里中英混排时
     * 一个汉字 9px、一个字母 6px，按字数切会让含英文的行提前溢出
     *（"木棍 x3 + 线 x1 = 木台钓竿"这种）。
     *
     * <p>空行返回一个空串（而不是空列表）—— 空行是排版的一部分，
     * 吞掉它会让段落之间的间距在折行路径上消失。
     */
    private static List<String> wrapLine(String line, int maxPx) {
        List<String> out = new ArrayList<>();
        if (line == null || line.isEmpty()) {
            out.add("");
            return out;
        }
        var font = Minecraft.getInstance().font;
        int start = 0;
        while (start < line.length()) {
            int end = start;
            while (end < line.length() && font.width(line.substring(start, end + 1)) <= maxPx) {
                end++;
            }
            if (end == start) {
                // 单个字符就超宽（正常文案不可能出现）。至少吃掉一个字符，
                // 否则 start 永远不动 → 死循环，把客户端卡死。
                end = start + 1;
            }
            out.add(line.substring(start, end));
            start = end;
        }
        return out;
    }

    private static int bodyColor(String line) {
        return (line.startsWith("【") || line.startsWith("本章")
                || line.startsWith("本页") || line.startsWith("Q "))
                ? C_LABEL : C_TEXT;
    }

    // ------------------------------------------------------------------ 文字工具
    /**
     * 目录按钮上的章节名：去掉"第X章 "前缀。
     *
     * <p>前缀对玩家没有信息量（正文顶部的章节标题里已经有了），
     * 去掉之后按钮能多显示 4 个字。只在"第一个空格出现在前 6 个字符内"时才去，
     * 免得把正常标题里的第一个词当章节号切掉。
     */
    private static String tocLabel(String title) {
        int sp = title.indexOf(' ');
        return (sp > 0 && sp < 6) ? title.substring(sp + 1) : title;
    }

    /**
     * 按像素把文字裁到能塞进按钮里：能塞多少塞多少，尾巴加省略号。
     *
     * <p>早先这里是 {@code trim(label, 8)} —— 固定 8 个字。中文标题平均 6~10 个字，
     * 8 个字的硬限把"三分钟学会钓鱼"截成"三分钟学会钓…"，
     * 而按钮其实还剩一半宽度。按像素裁能把这部分空间用起来。
     */
    private static String fit(String text, int maxPx) {
        var font = Minecraft.getInstance().font;
        if (font.width(text) <= maxPx) {
            return text;
        }
        int budget = maxPx - font.width("…");
        int end = 0;
        while (end < text.length() && font.width(text.substring(0, end + 1)) <= budget) {
            end++;
        }
        return text.substring(0, Math.max(1, end)) + "…";
    }

    private void addText(int x, int y, String text, int color) {
        // 宽度按"面板右缘 − 当前 x"算，并截断：TextWidget 内部是 drawString、不裁剪，
        // 面板一窄长文本就会压到边框外面（正文已按 bodyW 折行，这里只是兜底）
        int w = Math.max(8, left + panelW - 4 - x);
        TextWidget widget = new TextWidget(x, y, w, LINE_H, UiLayout.fitText(text, w), color, true, 0, 0);
        addRenderableWidget(widget);
        textWidgets.add(widget);
    }

    // ------------------------------------------------------------------ 绘制
    @Override
    public void render(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        this.renderBackground(g, mouseX, mouseY, partialTick);

        // 面板底色（只有底色用 fill，文字全走 Widget —— 见类注释）
        g.fill(left - 6, top - 6, left + panelW + 6, top + panelH + 6, C_SHADOW);
        g.fill(left - 4, top - 4, left + panelW + 4, top + panelH + 4, C_PANEL);
        // 目录栏与正文之间的竖分隔
        g.fill(left + tocW, top - 4, left + tocW + 2, top + panelH + 4, C_LINE);
        // 底部横分隔：把正文和翻页按钮分开，免得最后一行看起来像按钮的说明
        g.fill(left + 4, top + panelH - FOOTER_H + 2, left + panelW - 4,
                top + panelH - FOOTER_H + 3, C_LINE);

        // ⚠ 这里**不能**调 super.render()：Screen.render() 内部会再调一次
        // renderBackground()，那层全屏暗化会盖在刚刚画好的面板和文字上 ——
        // 表现就是"整个界面朦胧、白字发灰"，而 tooltip 清晰
        // （它在 renderWithTooltip 里最后画，盖不到）。
        // 4 个界面全中过这个坑，见 tools/check-screen-render.js。
        for (net.minecraft.client.gui.components.Renderable r : this.renderables) {
            r.render(g, mouseX, mouseY, partialTick);
        }
    }

    @Override
    public boolean isPauseScreen() {
        // 和改装/图鉴界面一致：开着教程书时游戏继续跑（钓鱼时翻书不该把鱼停下来）
        return false;
    }
}
