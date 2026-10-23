package com.whitecobalt.anglertackle.client.screen;

import com.whitecobalt.anglertackle.client.ClientCodex;
import com.whitecobalt.anglertackle.fishing.FishSpecies;
import com.whitecobalt.anglertackle.item.Quality;
import com.whitecobalt.anglertackle.network.CodexPayload;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.ItemStack;

import java.util.ArrayList;
import java.util.List;

/**
 * 鱼类图鉴界面。
 *
 * <p>布局：标题（完成度 + 进度条）／表头／列表（分页）／页脚。
 * 数据来自服务端下发的一份扁平快照（{@link CodexPayload}），
 * 客户端**只显示**，不参与任何"点亮/加币"的判断。
 *
 * <p><b>文字全部用 {@link TextWidget} 渲染</b>（与按钮同一条渲染路径），
 * 因为实测在本环境里 {@code graphics.drawString} 直接画出来的文字是糊的；
 * 底色、进度条、分隔线用 {@code g.fill}（糊一点无所谓，字清楚就行）。
 * 参考 {@link GuideScreen} 的类注释与配色常量。
 *
 * <h2>为什么未收集的鱼**不隐藏**（docs/16 §③）</h2>
 * 显示 {@code ?} 而不是跳过整行：玩家要能看到"还有多少种没见过"，
 * 图鉴才有收集目标。隐藏的话，"完成度 0%"和"只剩 3 种"看起来一模一样。
 *
 * <h2>为什么必须分页，而不是"装不下就 break"</h2>
 * {@link GuideScreen} 的正文循环是 {@code if (y > 底部) break;} ——
 * 那个写法在教程书里勉强能用（章节页数少、超了还有翻页），
 * 但图鉴是**固定 21 条**：break 掉的那几条玩家永远看不到，
 * 而且界面上没有任何"下面还有"的提示，看起来就是图鉴缺了几种鱼。
 * 所以这里按可用高度算出每页行数，再用页号取窗口，21 条一定能全部翻到。
 */
public class CodexScreen extends Screen {

    // ---------------------------------------------------------------- 尺寸
    //
    // ⚠ 420 → 470 是 2026-10-01 加「习性」列时改的。上限在哪：
    //   MC 的 GUI 会按"GUI 缩放"折成逻辑像素，把 1920×1080 按缩放 4 折出来只有 480×270；
    //   面板超过 480 就会在缩放 4 下**出屏**。所以 470 是留了 10px 余量的硬上限，
    //   再要加列就必须先把某一列挤窄，不能直接加宽。
    //
    // ⚠ 2026-10-02：**光靠上限还不够**。用户截图："很明显，图鉴的内容屏幕装不下了"——
    //   他那次窗口更小（约 337×210 逻辑像素），470 宽的面板左右都顶出屏幕：
    //   左边鱼名被切掉、最下面一行落到屏幕外。所以 470×224 现在只是**设计尺寸**，
    //   真正用的是 init() 里按窗口 clamp 出来的 panelW/panelH（见那里的注释）。
    private static final int PANEL_W = 570;
    private static final int PANEL_H = 224;
    /** 面板宽度下限（见 {@link UiLayout#panelW}）。 */
    private static final int MIN_W = 200;
    /** 每行高度。比字体高（8px + 阴影）留一点行距，挤在一起没法扫读。 */
    private static final int ROW_H = 11;
    /** 列表第一行相对面板顶的偏移。 */
    private static final int LIST_Y = 46;

    // ---------------------------------------------------------------- 列位置（相对面板左边界）
    //
    // 列宽是按**表头文字**卡的（MC 里一个汉字 9px）：
    //   次数(18) 最大体重(36) 最大体长(36) 最高品质(36) 习性(18)
    //   1.2.5 加了「出没」列：面板 470 → 570，各列重排（名称/数量/体重/体长/档位/习性/出没）
    // 习性列 318 → 444 留 126px（最长的三项短名约 8 字 = 72px ✓）；出没列 448 → 562 留 114px
    private static final int COL_NAME = 8;
    private static final int COL_COUNT = 112;
    private static final int COL_KG = 154;
    private static final int COL_CM = 210;
    private static final int COL_TIER = 266;
    private static final int COL_HABIT = 318;
    /** 出没（时段/天气/月相）：数据来自 FishHabits，和鱼池权重同一份（1.2.5）。 */
    private static final int COL_COND = 448;

    // ---------------------------------------------------------------- 配色（与 GuideScreen 同源）
    /** 标题 / 强调：金。 */
    private static final int C_TITLE = 0xFFFFD050;
    /** 表头标签：浅蓝。 */
    private static final int C_LABEL = 0xFF8FCBF5;
    /** 正文。 */
    private static final int C_TEXT = 0xFFE8E8E8;
    /** 次要（未收集的行）。 */
    private static final int C_DIM = 0xFFB0B0B0;
    /** 页脚提示。 */
    private static final int C_HINT = 0xFF909090;
    /** 习性词条列：青绿，和"数字列/品质列"在视觉上分开，扫一眼就知道那是标签不是数值。 */
    private static final int C_HABIT = 0xFF7FD8B0;
    /** 出没条件：淡金（和习性同为"这种鱼的属性"，但两者要能一眼分开）。 */
    private static final int C_COND = 0xFFE0C070;
    /** 面板底色。 */
    private static final int C_PANEL = 0xFF243028;
    /** 面板投影。 */
    private static final int C_SHADOW = 0xF0000000;
    /** 分隔线 / 进度条底槽。 */
    private static final int C_LINE = 0xFF5A6A60;
    /** 进度条底槽（比分隔线再深一点，免得和线混成一条）。 */
    private static final int C_BAR_TRACK = 0xFF3A4A40;

    /** 服务端给的这一份快照。{@code null} = 还没收到过任何同步。 */
    private CodexPayload data;
    private int page;
    private int left;
    private int top;

    /**
     * 本次实际用的面板尺寸 —— 由 {@link #init()} 按窗口算出来。
     *
     * <p>⚠ 每帧都读这两个字段，**不要**在别处直接用 {@link #PANEL_W}/{@link #PANEL_H}：
     * 那两个只是"窗口够大时的设计尺寸"，小窗口下会被 clamp 下来。
     */
    private int panelW = PANEL_W;
    private int panelH = PANEL_H;
    /**
     * 每页行数 —— <b>按面板高度算出来的，不是写死的</b>。
     *
     * <p>写死一个数字的话，窗口一小就会变成"最后几行落在屏幕外"，
     * 而用户 2026-10-02 截图报的正是这个（他那个窗口下 470×224 整个顶出屏幕）。
     */
    private int rowsPerPage = (PANEL_H - 24 - LIST_Y) / ROW_H;

    private final List<Button> buttons = new ArrayList<>();
    private final List<TextWidget> texts = new ArrayList<>();

    /**
     * 进度条的分子/分母。
     *
     * <p>在 {@code rebuild()} 里算好：{@code render()} 每帧都跑，
     * 不该在里面切字符串（21 行 × 60 帧的分配纯属浪费）。
     */
    private int barDone;
    private int barTotal;

    public CodexScreen(CodexPayload data) {
        super(Component.translatable("item.anglertackle.codex_book"));
        this.data = data;
        // 换了一份快照就从第一页开始：页码是**显示状态**，不跟着旧内容留着
        this.page = 0;
    }

    /**
     * 界面已经开着时收到新快照：原地换数据，不重新开窗。
     *
     * <p>照 {@code RodModScreen.acceptNewData} 的写法 —— 重新 {@code setScreen}
     * 会闪一下，而且会把页码和鼠标位置一起丢掉。
     */
    public void acceptNewData(CodexPayload fresh) {
        this.data = fresh;
        if (this.minecraft != null) {
            rebuild();
        }
    }

    /** 当前要画的那一份：优先用构造/刷新时给的那份，没有才看客户端缓存。 */
    private CodexPayload snapshot() {
        if (this.data != null) {
            return this.data;
        }
        // 构造时没拿到数据（理论上不会：界面就是收到包才开的）。
        // 这里退回缓存而不是直接画空列表 —— 见下面 rebuild() 的"读取中"分支。
        return ClientCodex.known() ? ClientCodex.latest() : null;
    }

    @Override
    protected void init() {
        // ★ 面板必须**装得进窗口**（原因见 UiLayout 的类注释）：
        //   用户 2026-10-02 的截图里，470 宽的面板左右都出屏 ——
        //   左边鱼名被切、最下面一行在屏幕外。
        panelW = UiLayout.panelW(this.width, PANEL_W, MIN_W);
        panelH = UiLayout.panelH(this.height, PANEL_H, LIST_Y + 24 + ROW_H + 6);
        rowsPerPage = UiLayout.rows(panelH, LIST_Y, 24, ROW_H);
        this.left = (this.width - panelW) / 2;
        this.top = (this.height - panelH) / 2;
        rebuild();
    }

    /**
     * 列的 x 坐标：按面板宽度**等比压缩**（面板等于设计宽度时就是原值）。
     *
     * @see UiLayout#fitX
     */
    private int col(int base) {
        return UiLayout.fitX(base, PANEL_W, panelW, COL_NAME);
    }

    // ------------------------------------------------------------------ 重建
    private void clearAll() {
        for (Button b : buttons) {
            this.removeWidget(b);
        }
        buttons.clear();
        for (TextWidget w : texts) {
            this.removeWidget(w);
        }
        texts.clear();
    }

    private void rebuild() {
        clearAll();
        barDone = 0;
        barTotal = 0;

        CodexPayload snap = snapshot();
        if (snap == null) {
            // 没收到过同步：**不画空列表**。
            // 空列表和"真的一条都没钓到"长得一模一样，玩家会以为自己刚钓的鱼没记上。
            addText(left + COL_NAME, top + 5, tr("item.anglertackle.codex_book"), C_TITLE);
            addText(left + COL_NAME, top + LIST_Y, tr("gui.anglertackle.codex_loading"), C_DIM);
            return;
        }

        List<String> rows = snap.rows();
        int total = snap.speciesTotal() > 0 ? snap.speciesTotal() : rows.size();

        // ---- 标题 ----
        int collected = countCollected(rows);
        barDone = collected;
        barTotal = total;
        int pct = total <= 0 ? 0 : (int) Math.round(100.0 * collected / total);
        addText(left + COL_NAME, top + 5, tr("gui.anglertackle.codex_title", pct), C_TITLE);
        // 右对齐：宽度按实际文字算，换语言（英文更长）时不会顶出面板
        String countText = tr("gui.anglertackle.codex_count", collected, total);
        addText(left + panelW - COL_NAME - Minecraft.getInstance().font.width(countText), top + 5,
                countText, C_LABEL);

        // ---- 表头 ----
        addText(left + COL_NAME, top + 31, tr("gui.anglertackle.codex_col_name"), C_LABEL);
        addText(left + col(COL_COUNT), top + 31, tr("gui.anglertackle.codex_col_count"), C_LABEL,
                col(COL_KG) - col(COL_COUNT));
        addText(left + col(COL_KG), top + 31, tr("gui.anglertackle.codex_col_kg"), C_LABEL,
                col(COL_CM) - col(COL_KG));
        addText(left + col(COL_CM), top + 31, tr("gui.anglertackle.codex_col_cm"), C_LABEL,
                col(COL_TIER) - col(COL_CM));
        addText(left + col(COL_TIER), top + 31, tr("gui.anglertackle.codex_col_tier"), C_LABEL,
                col(COL_HABIT) - col(COL_TIER));
        addText(left + col(COL_HABIT), top + 31, tr("gui.anglertackle.codex_col_habit"), C_LABEL,
                col(COL_COND) - col(COL_HABIT));
        addText(left + col(COL_COND), top + 31, tr("gui.anglertackle.codex_col_cond"), C_LABEL);

        // ---- 列表（分页）----
        int pages = pageCount(rows.size());
        if (page > pages - 1) {
            page = pages - 1;
        }
        if (page < 0) {
            page = 0;
        }
        int from = page * rowsPerPage;
        // ★ 上界用 min：这是"21 条一定能看完"的那一半保证。
        //   写成 rows.size() 会画出面板外面去；写成固定 21 又会在以后加鱼时越界。
        int to = Math.min(rows.size(), from + rowsPerPage);
        for (int i = from; i < to; i++) {
            drawRow(rows.get(i), top + LIST_Y + (i - from) * ROW_H);
        }

        // ---- 页脚 ----
        // ⚠ 版面（2026-10-12 重排）：**翻页条在按钮组左边**，而且按钮宽度随面板收窄。
        //   改之前是"翻页 [<] 在最左、[>] 在最右"，而 [>]（panelW-34）正好压在后来加的
        //   「排行榜」按钮（panelW-74，66 宽 = 到 panelW-8）下面 —— 两个按钮叠着，
        //   谁能点取决于加入顺序（点不到的那个看起来"没反应"，极难查 ✗）。
        //   现在右边按钮从面板右缘往左排、翻页条紧挨它们左侧、提示文字只在真有空位时画，
        //   三者永不重叠；面板窄（用户那个 337×210 的窗口 ⇒ 面板 321）时按钮一起收窄 ✓。
        boolean narrow = panelW < 420;
        int bw = narrow ? 46 : 62;
        int groupW = bw * 3 + 8;                      // 三个按钮 + 两个 4px 间隔
        int groupX = left + panelW - 6 - groupW;
        int pagerRight = groupX - 8;
        int navW = narrow ? 18 : 26;
        int nextX = pagerRight - navW;
        int prevX = nextX - 4 - navW;
        // 提示文字（页码 / Esc）：从左往右放，放不下就不画 —— 它们是信息，按钮是功能，
        // 挤的时候先牺牲信息（与 UiLayout.fitText 同一个取舍）
        int textRoom = prevX - 4 - (left + 8);
        if (textRoom >= 90) {
            addText(left + 8, top + panelH - 20, tr("gui.anglertackle.codex_esc"), C_HINT, 60);
            addText(left + 8 + 72, top + panelH - 20,
                    tr("gui.anglertackle.codex_page", page + 1, pages), C_HINT, textRoom - 72);
        } else if (textRoom >= 30) {
            addText(left + 8, top + panelH - 20,
                    tr("gui.anglertackle.codex_page", page + 1, pages), C_HINT, textRoom);
        }

        // ---- 排行榜入口（用户 2026-10-11："排行榜可以通过图鉴打开，类似点击那个按钮
        //      执行打开排行榜的指令，**无需权限**"）----
        //
        // ⚠ 这里**不是**"客户端自己造一份榜" —— 按钮只发出与 `/atl rank` **完全相同**的那个
        //   请求包（`RankRequestPayload`），服务端照旧只读数据、原样发回（`ModNetwork.handleRankRequest`）。
        //   ⇒ 客户端拿不到任何"自己算的名次"，也改不了任何数（服务端权威那条原则不破）。
        // ⚠ 也不能直接 `setScreen(new LeaderboardScreen(...))`：那个 Screen 要 `RankPayload`，
        //   手上没有包时打开只会是一张空榜（看起来像"排行榜没数据"）。
        Button rank = Button.builder(Component.translatable("gui.anglertackle.codex_rank"), b ->
                net.neoforged.neoforge.client.network.ClientPacketDistributor.sendToServer(
                        new com.whitecobalt.anglertackle.network.RankRequestPayload("")))
                .bounds(groupX + 2 * (bw + 4), top + panelH - 22, bw, 18).build();
        addRenderableWidget(rank);
        buttons.add(rank);

        // ---- 邮箱入口（用户 2026-10-11 点名要的邮件系统；`docs/36` §5.7 的三个入口之一）----
        //
        // 与排行榜按钮**完全同一条形状**：只发一个请求包（`MailActionPayload(OPEN)`），
        // 由服务端把快照发回来、客户端才开界面 ⇒ 客户端既造不出邮件、也改不了任何状态 ✓。
        Button mail = Button.builder(Component.translatable("gui.anglertackle.codex_mail"), b ->
                net.neoforged.neoforge.client.network.ClientPacketDistributor.sendToServer(
                        new com.whitecobalt.anglertackle.network.MailActionPayload(
                                com.whitecobalt.anglertackle.network.MailActionPayload.OPEN, -1)))
                .bounds(groupX + (bw + 4), top + panelH - 22, bw, 18).build();
        addRenderableWidget(mail);
        buttons.add(mail);

        // ---- 称号入口（用户 2026-10-12："称号佩戴在哪，很难发现。"）----
        //
        // 第三个按钮，形状与前两个**逐字相同**：只发一个请求包（`TitleActionPayload(OPEN)`），
        // 服务端把称号全表快照发回来、客户端才开界面 ⇒ 客户端既改不了"我有哪些称号"，
        // 也改不了"我戴着哪个"（佩戴要再发一次 EQUIP，由 `Titles.equip` 判）✓。
        Button titles = Button.builder(Component.translatable("gui.anglertackle.codex_titles"), b ->
                net.neoforged.neoforge.client.network.ClientPacketDistributor.sendToServer(
                        new com.whitecobalt.anglertackle.network.TitleActionPayload(
                                com.whitecobalt.anglertackle.network.TitleActionPayload.OPEN, "")))
                .bounds(groupX, top + panelH - 22, bw, 18).build();
        addRenderableWidget(titles);
        buttons.add(titles);

        if (pages > 1) {
            // 行数在 lambda 里要用：拷成 final（rows 不是 effectively final
            // 的话按钮回调编译不过 —— 这类错编译期就报，算好事）
            final int rowCount = rows.size();
            Button prev = Button.builder(Component.literal("<"), b -> {
                if (page > 0) {
                    page--;
                    rebuild();
                }
            }).bounds(prevX, top + panelH - 22, navW, 18).build();
            addRenderableWidget(prev);
            buttons.add(prev);

            Button next = Button.builder(Component.literal(">"), b -> {
                if (page < pageCount(rowCount) - 1) {
                    page++;
                    rebuild();
                }
            }).bounds(nextX, top + panelH - 22, navW, 18).build();
            addRenderableWidget(next);
            buttons.add(next);
        }
    }

    private int pageCount(int rowCount) {
        return Math.max(1, (rowCount + rowsPerPage - 1) / rowsPerPage);
    }

    /** 已点亮数：判据与 {@link ClientCodex#collectedCount()} 一致（次数 &gt; 0）。 */
    private static int countCollected(List<String> rows) {
        int n = 0;
        for (String r : rows) {
            String[] f = r.split("\\|", -1);
            if (f.length > 1 && parseInt(f[1]) > 0) {
                n++;
            }
        }
        return n;
    }

    /** 画一行：中文名 / 次数 / 最大体重 / 最大体长 / 最高品质。 */
    private void drawRow(String row, int y) {
        String[] f = row.split("\\|", -1);
        if (f.length < 7) {
            // 行格式对不上（服务端老版本 / 有人手改过包）。
            // 画一个 ? 而不是跳过：跳过会让"图鉴少了一种鱼"和"包格式不对"
            // 这两种完全不同的故障在界面上长得一样。
            addText(left + COL_NAME, y, "?", C_DIM);
            return;
        }
        String id = f[0];
        int count = parseInt(f[1]);
        int tier = parseInt(f[6]);

        if (count <= 0) {
            // 未收集：整行灰掉，名字画 ?，数值画 -（不画 0.00，那看起来像"钓到过但很小"）
            addText(left + COL_NAME, y, "?", C_DIM);
            addText(left + col(COL_COUNT), y, "-", C_DIM, col(COL_KG) - col(COL_COUNT));
            addText(left + col(COL_KG), y, "-", C_DIM, col(COL_CM) - col(COL_KG));
            addText(left + col(COL_CM), y, "-", C_DIM, col(COL_TIER) - col(COL_CM));
            addText(left + col(COL_TIER), y, "-", C_DIM, col(COL_HABIT) - col(COL_TIER));
            addText(left + col(COL_HABIT), y, "-", C_DIM, col(COL_COND) - col(COL_HABIT));
            // ⚠ 出没列**即使没收集也照常显示**：它是"这种鱼的属性"（和习性同一类），
            //   不是"你钓到过什么"。玩家正是靠它决定"今晚要不要去守这条鱼" ——
            //   要求先钓到才告诉你什么时候能钓到，等于把唯一有用的信息锁在结果后面。
            addText(left + col(COL_COND), y, condText(id), C_DIM);
            return;
        }

        addText(left + COL_NAME, y, speciesName(id), C_TEXT, col(COL_COUNT) - COL_NAME);
        addText(left + col(COL_COUNT), y, String.valueOf(count), C_TEXT, col(COL_KG) - col(COL_COUNT));
        addText(left + col(COL_KG), y, fmtKg(f[2]), C_TEXT, col(COL_CM) - col(COL_KG));
        addText(left + col(COL_CM), y, fmtCm(f[3]), C_TEXT, col(COL_TIER) - col(COL_CM));

        // 最高档位：中文档名 + 该档的颜色，和物品 tooltip 用的是同一套 Quality
        //（白绿蓝紫金红各占一个颜色，玩家学一次就够）。
        Quality q = Quality.of(tier);
        addText(left + col(COL_TIER), y,
                Component.translatable("tooltip.anglertackle.quality." + q.key()).getString(),
                tierColor(q), col(COL_HABIT) - col(COL_TIER));

        // ★ 习性词条：「这条鱼吃什么饵」的答案。
        //
        //   为什么画在**图鉴**而不是鱼获 tooltip 上（用户 2026-10-01 定案）：
        //   词条是"这种鱼的属性"，不是"这条鱼的属性"—— 钓上来的鱼获只带体重/体长，
        //   把习性塞进鱼获 tooltip 会让同一句话在背包里重复 20 遍。
        //
        //   词条 id → 名字走**短名** key（habit.anglertackle.<id>.short）：
        //   这一列只有 122px，全名「领地意识强·性情凶猛·胆小多疑」要 135px，排不下。
        //   全名留给拟饵 tooltip（那里有整行宽度）。
        addText(left + col(COL_HABIT), y, habitText(id), C_HABIT, col(COL_COND) - col(COL_HABIT));

        // ★ 出没条件（1.2.5）：时段 · 天气 · 月相。
        //
        //   数据走 FishHabits 的 timeMaskOf/weatherMaskOf/moonOf —— 与**鱼池加权**是同一份表，
        //   所以图鉴上写的条件就是真正影响"这条鱼什么时候更容易上钩"的条件，不可能对不上
        //   （docs/24 §7 表格里那三条 ⏳ 待做，就是这一列）。
        addText(left + col(COL_COND), y, condText(id), C_COND,
                panelW - col(COL_COND) - COL_NAME);
    }

    /**
     * 鱼种 id → 出没条件短文案（例如 {@code 夜·雨·满月}）。
     *
     * <p>掩码口径与 {@link com.whitecobalt.anglertackle.fishing.FishHabits} 完全一致：
     * {@code timeMask} bit0 清晨 / bit1 白天 / bit2 黄昏 / bit3 夜晚（{@code 0b1111} = 全天）、
     * {@code weatherMask} bit0 晴 / bit1 雨、{@code moonKind} 0 不限 / 1 满月 / 2 新月。
     *
     * <p>三段都用语言键拼，中英各一份；月相不限时不占位（不然每条鱼都拖一条"· 不限"）。
     */
    private static String condText(String id) {
        int time = com.whitecobalt.anglertackle.fishing.FishHabits.timeMaskOf(id);
        int weather = com.whitecobalt.anglertackle.fishing.FishHabits.weatherMaskOf(id);
        int moon = com.whitecobalt.anglertackle.fishing.FishHabits.moonOf(id);

        String timeText;
        if (time == 0 || (time & 0b1111) == 0b1111) {
            timeText = tr("gui.anglertackle.codex_time.all");
        } else {
            String[] keys = {"dawn", "day", "dusk", "night"};
            StringBuilder sb = new StringBuilder();
            for (int bit = 0; bit < 4; bit++) {
                if ((time & (1 << bit)) != 0) {
                    if (sb.length() > 0) {
                        sb.append('/');
                    }
                    sb.append(tr("gui.anglertackle.codex_time." + keys[bit]));
                }
            }
            timeText = sb.toString();
        }
        String weatherText = switch (weather & 0b11) {
            case 0b01 -> tr("gui.anglertackle.codex_weather.clear");
            case 0b10 -> tr("gui.anglertackle.codex_weather.rain");
            case 0b11 -> tr("gui.anglertackle.codex_weather.any");
            default -> tr("gui.anglertackle.codex_weather.any");
        };
        String text = timeText + "·" + weatherText;
        if (moon == 1) {
            text += "·" + tr("gui.anglertackle.codex_moon.full");
        } else if (moon == 2) {
            text += "·" + tr("gui.anglertackle.codex_moon.new");
        }
        return text;
    }

    /**
     * 鱼种 id → 习性短名，用 {@code ·} 连接（例如 {@code 深水·领地·凶猛}）。
     *
     * <p>走 {@link FishHabits#habitsOf(String)}，也就是和鱼池权重**同一份**数据 ——
     * 图鉴上写着的词条，就是真正在加权的那些，不可能对不上。
     */
    private static String habitText(String id) {
        var list = com.whitecobalt.anglertackle.fishing.FishHabits.habitsOf(id);
        if (list.isEmpty()) {
            // 数据里每条鱼都至少有一个词条（check-fish-habits.js 守着），
            // 走到这里只可能是"客户端版本比数据包旧"，画个 - 而不是空白。
            return "-";
        }
        StringBuilder sb = new StringBuilder();
        for (var h : list) {
            if (sb.length() > 0) {
                sb.append('·');
            }
            sb.append(Component.translatable(h.langKey() + ".short").getString());
        }
        return sb.toString();
    }

    /**
     * 鱼种 id → 中文名。
     *
     * <p>走**物品的显示名**而不是另写一张名字表：语言文件里已经有一条
     * {@code item.anglertackle.<id>}，再造一份"图鉴用的名字"必然和中英两份语言文件漂移。
     */
    private static String speciesName(String id) {
        FishSpecies sp = FishSpecies.byId(id);
        if (sp == null) {
            // 认不出的 id（数据包加了新鱼但客户端是旧版本）：把 id 原样画出来。
            // 画 id 至少让人知道"有这么一条"，比显示成空白强。
            return id;
        }
        return new ItemStack(sp.item().get()).getHoverName().getString();
    }

    /** 档位 → ARGB 颜色，直接取 {@link Quality} 的 {@code ChatFormatting}，不再抄一份色表。 */
    private static int tierColor(Quality q) {
        Integer rgb = q.color().getColor();
        return 0xFF000000 | (rgb == null ? 0xFFFFFF : rgb);
    }

    /**
     * 体重显示。
     *
     * <p>两位小数会把小鱼压成 {@code 0.00}：横纹鱼只有 3~30 <b>克</b>（0.003~0.030 kg），
     * 白条鱼 20~232 克。所以小于 0.1 kg 时多给一位有效数字。
     */
    private static String fmtKg(String raw) {
        float v = parseFloat(raw);
        return (v < 0.1f ? String.format("%.3f", v) : String.format("%.2f", v)) + " kg";
    }

    private static String fmtCm(String raw) {
        return String.format("%.1f", parseFloat(raw)) + " cm";
    }

    // 手改过的包 / 老版本服务端都可能给出解析不了的数字。
    // 显示路径上宁可画 0 也不要抛异常 —— 为一个数字把玩家客户端搞崩不值得。
    private static int parseInt(String s) {
        try {
            return Integer.parseInt(s.trim());
        } catch (RuntimeException e) {
            return 0;
        }
    }

    private static float parseFloat(String s) {
        try {
            return Float.parseFloat(s.trim());
        } catch (RuntimeException e) {
            return 0f;
        }
    }

    /** 取语言文件里的字符串。键名写成字面量（而不是常量），方便检查脚本核对键是否齐全。 */
    private static String tr(String key, Object... args) {
        return Component.translatable(key, args).getString();
    }

    private void addText(int x, int y, String text, int color) {
        addText(x, y, text, color, left + panelW - 4 - x);
    }

    /**
     * 带宽度上限的一版：超宽就截断加省略号。
     *
     * <p>⚠ 必须自己截：{@link TextWidget} 里是 {@code drawString}，**不会裁剪** ——
     * 面板一窄（窗口小 / GUI 缩放 4），习性那列的长文本会直接压到右边框外面去。
     * 截断用的是字体自己的宽度表，中英混排都算得准。
     */
    private void addText(int x, int y, String text, int color, int maxWidth) {
        int w = Math.max(8, maxWidth);
        TextWidget widget = new TextWidget(x, y, w, ROW_H, UiLayout.fitText(text, w), color, true, 0, 0);
        addRenderableWidget(widget);
        texts.add(widget);
    }

    // ------------------------------------------------------------------ 绘制
    @Override
    public void extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float partialTick) {
        // 背景由 extractBackground 提前抽取，这里只画内容。

        // 面板：投影 + 底色。只有底色用 fill，文字全走 Widget（见类注释）。
        g.fill(left - 6, top - 6, left + panelW + 6, top + panelH + 6, C_SHADOW);
        g.fill(left - 4, top - 4, left + panelW + 4, top + panelH + 4, C_PANEL);
        // 三条分隔线：标题下 / 表头下 / 页脚上
        g.fill(left - 4, top + 18, left + panelW + 4, top + 19, C_LINE);
        g.fill(left + 4, top + 43, left + panelW - 4, top + 44, C_LINE);
        g.fill(left + 4, top + panelH - 24, left + panelW - 4, top + panelH - 23, C_LINE);

        // 进度条：底槽 + 已完成段（金 = 和标题同色）。
        // 用 fill 而不是贴图：进度条只是一条色带，fill 的"糊"完全看不出来。
        int bx0 = left + COL_NAME;
        int bx1 = left + panelW - COL_NAME;
        int by0 = top + 22;
        int by1 = top + 28;
        g.fill(bx0, by0, bx1, by1, C_BAR_TRACK);
        if (barTotal > 0 && barDone > 0) {
            // 至少 2px：只差最后一种鱼时进度条不该整个消失
            int w = Math.max(2, (bx1 - bx0) * barDone / barTotal);
            g.fill(bx0, by0, bx0 + w, by1, C_TITLE);
        }

        // ⚠ 这里**不能**调 super.extractRenderState()：背景已由 extractBackground 提前抽取，
        // 再调一次会让全屏暗化盖在刚刚画好的面板和文字上 ——
        // 表现就是"整个界面朦胧、白字发灰"（守着这条的是 tools/check-screen-render.js）。
        for (net.minecraft.client.gui.components.Renderable r : this.renderables) {
            r.extractRenderState(g, mouseX, mouseY, partialTick);
        }
    }

    @Override
    public boolean isPauseScreen() {
        // 和改装界面一致：开着图鉴时游戏继续跑（钓鱼时翻图鉴不该把鱼停下来）
        return false;
    }
}
