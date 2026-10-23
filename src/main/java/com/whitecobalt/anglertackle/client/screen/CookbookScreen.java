package com.whitecobalt.anglertackle.client.screen;

import com.whitecobalt.anglertackle.effect.DishEffects;
import com.whitecobalt.anglertackle.effect.EffectText;
import com.whitecobalt.anglertackle.fishing.FoodValues;
import com.whitecobalt.anglertackle.item.Quality;
import com.whitecobalt.anglertackle.recipe.CuttingRecipe;
import com.whitecobalt.anglertackle.recipe.DishRecipe;
import com.whitecobalt.anglertackle.recipe.OilPressingRecipe;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.item.crafting.Recipe;
import net.minecraft.world.item.crafting.RecipeHolder;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 菜谱界面（用户 2026-10-03 两轮反馈的落地）。
 *
 * <h2>第一轮</h2>
 * "制作菜谱，菜谱合成方式（原版任意熟鱼加书）" —— 于是有了这个界面与那本书。
 *
 * <h2>第二轮（本次重写）</h2>
 * "一个是菜谱不完善，12道菜只介绍10道，二个是配方表达不完整清晰，只提到需要的鱼，
 *  却不提怎么加工，需要什么额外的配料，配料又怎么合成"
 *
 * <p>两个问题的根因都很具体：
 * <ol>
 *   <li><b>只介绍 10 道</b>：界面当时只遍历 {@code DishRecipe.Dish.values()}，
 *       而那个枚举里**只有工作台做的 10 道**；熏鱼与炭烤鱼是**设备做的**
 *       （烟熏炉 / 营火，配方类型 {@code chunk_smoking} / {@code chunk_campfire}），
 *       压根不在那个枚举里。所以清单现在按**物品**算：10 道工作台菜 + 2 道设备菜 = 12。</li>
 *   <li><b>配方说不清</b>：原来只列了"能用哪些鱼"。现在分两栏 ——
 *       「做法」给出**基础（熟块/生块/整条）+ 数量 + 配料清单 + 三步加工链 + 每种配料怎么来**；
 *       「效果」给出饱食度与三档效果。</li>
 * </ol>
 *
 * <h2>数据来源（一条都不许手抄）</h2>
 * <table>
 *   <tr><td>能用哪些鱼</td><td>{@code DishRecipe.allowedPairs()}（配方表本身）</td></tr>
 *   <tr><td>基础与配料</td><td>{@code DishRecipe.Dish#base()/baseCount()/extraItems()}（配方就是按它收料的）</td></tr>
 *   <tr><td>配料怎么来</td><td><b>现场问客户端的配方管理器</b>：谁的产物是这个物品，就显示谁的配方</td></tr>
 *   <tr><td>效果与饱食度</td><td>{@code DishEffects.grantsFor()} / {@code FoodValues}</td></tr>
 * </table>
 *
 * <p>最后一行那个"现场问配方管理器"很关键：配料的合成式（酱油 = 小麦×2 + 海带 + 糖、
 * 鱼油 = 榨油…）一旦手写进界面，游戏里改了配方这里就会撒谎；而问出来的永远是**当前生效的**
 * 那一份，别的 mod 覆盖了配方也照样对。
 *
 * <h2>界面约定</h2>
 * 与图鉴/指南同款：设计 400×224、按窗口现算面板尺寸；文字走 {@link TextWidget}；
 * 左侧一列 **12 道菜分两栏**（6 行 × 2 列）—— 单列 12 行在矮窗口下会掉行，
 * 而"少两道"正是用户报上来的问题之一。
 */
public class CookbookScreen extends Screen {

    // ---- 设计尺寸（check-ui-fit.js 会读这几个常量，并在四种窗口下验算装不装得下）----
    private static final int PANEL_W = 400;
    private static final int PANEL_H = 224;
    private static final int MIN_W = 240;
    /** 左侧菜名列表的第一行 y（面板内坐标）。 */
    private static final int LIST_Y = 28;
    /** 每道菜一行的高度。 */
    private static final int ROW_H = 15;
    /** 左侧两栏的 x（面板内坐标）：12 道菜 = 6 行 × 2 栏。 */
    private static final int LIST_COL0 = 10;
    private static final int LIST_COL1 = 66;
    /** 右侧详情的起始 x 与第一行 y（面板内坐标）。 */
    private static final int DETAIL_X = 128;
    private static final int DETAIL_Y = 44;
    private static final int LINE_H = 12;
    /** 底部提示行占的高度。 */
    private static final int FOOTER_H = 24;

    private static final int C_SHADOW = 0xC0000000;
    private static final int C_PANEL = 0xF0181A1E;
    private static final int C_LINE = 0xFF4A4E58;
    private static final int C_SELECT = 0x50FFD24A;
    private static final int C_TITLE = 0xFFE8B33C;
    private static final int C_TEXT = 0xFFE2E2E6;
    private static final int C_DIM = 0xFF9A9AA2;
    private static final int C_OK = 0xFF6FC7E8;

    /**
     * 12 道菜的清单：10 道工作台菜（{@code DishRecipe.Dish}）+ 2 道设备菜。
     *
     * <p>设备菜**故意不在** {@code Dish} 枚举里：那个枚举的每个值都对应一族
     * {@code anglertackle:dish/<鱼种>} 配方，而熏鱼/炭烤鱼是烟熏炉/营火的配方 ——
     * 塞进去就得给它们造一个不存在的配方序列化器。所以在这里补两条，
     * 但清单总数必须等于"游戏里的成品菜物品数"，由 check-cookbook.js 盯着。
     */
    private static final List<String> DEVICE_DISHES = List.of("smoked_fish", "charred_fish");

    private int panelW = PANEL_W;
    private int panelH = PANEL_H;
    private int visibleRows = 6;

    private final List<String> dishes = allDishes();
    private String selected = dishes.get(0);
    private int scroll;
    /** 当前选中的行在面板内的 y（渲染高亮用）。 */
    private int selectedRowY = LIST_Y;
    private int selectedCol = 0;
    /** 右栏显示哪一页：false = 做法，true = 效果。 */
    private boolean showEffect;

    public CookbookScreen() {
        super(Component.translatable("screen.anglertackle.cookbook"));
    }

    /** 12 道菜：10 道工作台菜 + 2 道设备菜。 */
    private static List<String> allDishes() {
        List<String> out = new ArrayList<>();
        for (DishRecipe.Dish d : DishRecipe.Dish.values()) {
            out.add(d.id());
        }
        out.addAll(DEVICE_DISHES);
        return out;
    }

    @Override
    protected void init() {
        panelW = UiLayout.panelW(this.width, PANEL_W, MIN_W);
        panelH = UiLayout.panelH(this.height, PANEL_H, LIST_Y + FOOTER_H + ROW_H * 3);
        visibleRows = Math.max(3, UiLayout.rows(panelH, LIST_Y, FOOTER_H, ROW_H));
        // 每次打开界面重查一次配料来源：换个世界/换套数据包之后，上一条缓存就可能过期
        SOURCE_CACHE.clear();
        rebuild();
    }

    private void rebuild() {
        clearWidgets();

        int left = (this.width - panelW) / 2;
        int top = (this.height - panelH) / 2;
        int colW = DETAIL_X - LIST_COL1 - 6;
        int detailW = panelW - DETAIL_X - 12;

        // ---- 左：两栏菜名（6 行 × 2 栏）----
        int perCol = Math.max(1, Math.min(visibleRows, (dishes.size() + 1) / 2));
        scroll = Math.max(0, Math.min(scroll, Math.max(0, dishes.size() - perCol * 2)));
        for (int i = 0; i < dishes.size() - scroll && i < perCol * 2; i++) {
            int col = i / perCol;
            int row = i % perCol;
            int x = col == 0 ? LIST_COL0 : LIST_COL1;
            boolean sel = selected.equals(dishes.get(i + scroll));
            if (sel) {
                selectedRowY = LIST_Y + row * ROW_H;
                selectedCol = col;
            }
            addText(left + x, top + LIST_Y + row * ROW_H, dishName(dishes.get(i + scroll)),
                    colW, sel ? C_TITLE : C_TEXT);
        }

        // ---- 右上：两页切换 ----
        addRenderableWidget(Button.builder(
                        Component.translatable("screen.anglertackle.cookbook.tab.recipe"),
                        (b) -> { showEffect = false; rebuild(); })
                .bounds(left + DETAIL_X, top + 10, 46, 18).build());
        addRenderableWidget(Button.builder(
                        Component.translatable("screen.anglertackle.cookbook.tab.effect"),
                        (b) -> { showEffect = true; rebuild(); })
                .bounds(left + DETAIL_X + 50, top + 10, 46, 18).build());

        // ---- 右下：内容 ----
        List<Line> lines = showEffect ? effectLines(selected, detailW) : recipeLines(selected, detailW);
        int rows = UiLayout.rows(panelH, DETAIL_Y, FOOTER_H, LINE_H);
        for (int i = 0; i < lines.size() && i < rows; i++) {
            String text = lines.get(i).text;
            if (i == rows - 1 && lines.size() > rows) {
                text = text + "…";
            }
            addText(left + DETAIL_X, top + DETAIL_Y + i * LINE_H, text, detailW, lines.get(i).color);
        }

        addText(left + 12, top + panelH - FOOTER_H + 6,
                Component.translatable("screen.anglertackle.cookbook.footer").getString(),
                panelW - 24, C_DIM);
    }

    // ---------------------------------------------------------------- 做法

    /** 「做法」页：基础 + 配料 + 加工链 + 每种配料怎么来。 */
    private List<Line> recipeLines(String dishId, int width) {
        List<Line> out = new ArrayList<>();
        DishRecipe.Dish dish = dishOf(dishId);
        String name = dishName(dishId);

        // ① 鱼
        out.add(new Line(section("fish") + fishList(dishId), C_TEXT));

        if (dish == null) {
            // 设备菜（熏鱼 / 炭烤鱼）：配方类型是 chunk_smoking / chunk_campfire
            String device = Component.translatable("screen.anglertackle.cookbook.device."
                    + ("smoked_fish".equals(dishId) ? "smoker" : "campfire")).getString();
            out.add(new Line(section("steps"), C_DIM));
            out.add(new Line(cutStep(), C_TEXT));
            out.add(new Line(Component.translatable("screen.anglertackle.cookbook.step.device",
                    device, name).getString(), C_TEXT));
            out.add(new Line(Component.translatable("screen.anglertackle.cookbook.note."
                    + dishId).getString(), C_DIM));
            return out;
        }

        // ② 基础 + 配料
        String base = Component.translatable("screen.anglertackle.cookbook.base."
                + dish.base().name().toLowerCase()).getString();
        out.add(new Line(section("base") + base + " ×" + dish.baseCount(), C_TEXT));
        out.add(new Line(section("extra") + (dish.extraItems().isEmpty()
                ? Component.translatable("screen.anglertackle.cookbook.none").getString()
                : itemNames(dish)), C_TEXT));

        // ③ 加工链（切块 → 加热 → 合成；生食与整条下锅没有加热那一步）
        out.add(new Line(section("steps"), C_DIM));
        if (dish.base() == DishRecipe.Base.WHOLE_FISH) {
            out.add(new Line(Component.translatable(
                    "screen.anglertackle.cookbook.step.whole").getString(), C_TEXT));
        } else {
            out.add(new Line(cutStep(), C_TEXT));
            if (dish.base() == DishRecipe.Base.COOKED) {
                // ⚠ 只有熔炉出熟块：营火出的是**炭烤鱼**、烟熏炉出的是**熏鱼**（各是独立物品）。
                //   第一版这里写成"熔炉 / 营火 / 烟熏炉--> 熟鱼块"，是错的（用户 2026-10-03 指出）。
                out.add(new Line(Component.translatable(
                        "screen.anglertackle.cookbook.step.heat").getString(), C_TEXT));
            }
        }
        out.add(new Line(Component.translatable("screen.anglertackle.cookbook.step.craft",
                craftInput(dish), name).getString(), C_TEXT));

        // ④ 每种配料怎么来（现场问配方管理器）
        if (!dish.extraItems().isEmpty()) {
            out.add(new Line(section("source"), C_DIM));
            for (Item item : dish.extraItems()) {
                out.add(new Line(sourceLine(item), C_TEXT));
                String extraNote = extraNote(item);
                if (!extraNote.isEmpty()) {
                    out.add(new Line("    " + extraNote, C_DIM));
                }
            }
        }
        // ⑤ 有 5 条鱼**什么菜都做不了**，而且菜谱里永远看不到它们（本来就不在菜品菜单里）——
        //    玩家只会觉得"这几条怎么什么用都没有"。所以要把原因写出来。
        //    名单**从 FishPalatability 现取**（与悬浮文本、与真正发效果、与味道提示同一张表），
        //    界面**不抄第二份** —— 否则以后动等级表时，这一行就成了谎话（docs/29 那条纪律）。
        List<String> inedible = com.whitecobalt.anglertackle.recipe.FishPalatability.inedibleSpecies();
        if (!inedible.isEmpty()) {
            List<String> names = new ArrayList<>();
            for (String id : inedible) {
                names.add(Component.translatable("item.anglertackle." + id).getString());
            }
            out.add(new Line(Component.translatable(
                    com.whitecobalt.anglertackle.recipe.FishPalatability.INEDIBLE_KEY).getString()
                    + "：" + String.join("、", names), C_DIM));
        }
        return out;
    }

    /**
     * 切块那一行。
     *
     * <p><b>切块是工作台配方，不是"手持鱼刀右键"</b> —— 真源是
     * {@code recipe/cutting.json}（类型 {@code anglertackle:cutting}，材料就是整鱼标签），
     * 所以提示里必须写"放进工作台"；份数范围也从 {@code CuttingRecipe} 的常量现取
     * （{@code MIN_CHUNKS}~{@code MAX_CHUNKS}），不写死在文案里。
     *
     * <p>2026-10-03 用户看截图指出："很明显，鱼块的做法不是这样的。"
     * —— 第一版写的是"整鱼 --鱼刀右键--> 鱼块"，而鱼刀压根没有右键功能，
     * 它只是**刺身配方里不消耗的工具**。
     */
    private static String cutStep() {
        return Component.translatable("screen.anglertackle.cookbook.step.cut",
                CuttingRecipe.MIN_CHUNKS, CuttingRecipe.MAX_CHUNKS).getString();
    }

    /** 合成那一行的左边（"熟鱼块 ×1 + 酱油 + 糖"）。 */
    private String craftInput(DishRecipe.Dish dish) {
        String base = Component.translatable("screen.anglertackle.cookbook.base."
                + dish.base().name().toLowerCase()).getString() + " ×" + dish.baseCount();
        List<String> parts = new ArrayList<>();
        parts.add(base);
        for (Item item : dish.extraItems()) {
            parts.add(item.getDescription().getString());
        }
        return String.join(" + ", parts);
    }

    /**
     * 配料清单（"酱油 + 鱼油 / 油脂"）。
     *
     * <p>有"同类替代"的配料用 {@code /} 并列 —— 名字**从标签现算**
     * （{@code Dish#substituteNames}），所以森罗物语装没装、标签里有什么，
     * 这里显示的就是什么，不会出现"界面写着能替代、实际不行"（docs/30 §7.7）。
     */
    private String itemNames(DishRecipe.Dish dish) {
        List<String> parts = new ArrayList<>();
        List<Item> items = dish.extraItems();
        for (int i = 0; i < items.size(); i++) {
            String s = String.join(" / ", dish.substituteNames(i));
            String note = extraNote(items.get(i));
            parts.add(note.isEmpty() ? s : s + note);
        }
        return String.join(" + ", parts);
    }

    /** 水桶/鱼刀的特别说明（都不是"被吃掉"的那种材料）。 */
    private static String extraNote(Item item) {
        if (item == net.minecraft.world.item.Items.WATER_BUCKET) {
            return Component.translatable("screen.anglertackle.cookbook.bucket_note").getString();
        }
        if (item == com.whitecobalt.anglertackle.registry.ModItems.FISH_KNIFE.get()) {
            return Component.translatable("screen.anglertackle.cookbook.knife_note").getString();
        }
        return "";
    }

    /**
     * 这个物品怎么做出来的 —— <b>现场问客户端的配方管理器</b>。
     *
     * <p>为什么不手写一张表：配料的合成式会变（盐/酱油/芥末/鱼刀的 JSON 都在数据包里），
     * 界面里的表一旦手写就会撒谎。问出来的永远是当前生效的那一份，
     * 连别的 mod 覆盖配方、或者数据包改了配方，这里都跟着变。
     *
     * <p>找不到配方就老实说"原版材料"（例如甘蔗、小麦本身没有合成配方）。
     */
    private static String sourceLine(Item item) {
        String cached = SOURCE_CACHE.get(item);
        if (cached != null) {
            return cached;
        }
        String text = null;
        Minecraft mc = Minecraft.getInstance();
        if (mc.level != null) {
            for (RecipeHolder<?> holder : mc.level.getRecipeManager().getRecipes()) {
                Recipe<?> recipe = holder.value();
                if (!recipe.getResultItem(mc.level.registryAccess()).is(item)) {
                    continue;
                }
                List<String> names = new ArrayList<>();
                for (Ingredient ing : recipe.getIngredients()) {
                    ItemStack[] stacks = ing.getItems();
                    if (stacks.length > 0) {
                        names.add(stacks[0].getHoverName().getString());
                    }
                }
                String label = station(holder.id().toString(), recipe);
                text = Component.translatable("screen.anglertackle.cookbook.source",
                        item.getDescription().getString(),
                        label + (names.isEmpty() ? "" : "：" + String.join(" + ", names))).getString();
                // 榨油的份数（瘦鱼 2 块 / 多脂鱼 1 块）在配方里表达不出来（自定义配方的 matches 里算的），
                // 所以从 OilPressingRecipe 的公开常量现取 —— 依旧不写死数字
                if (typeOf(recipe).equals("oil_pressing")) {
                    text += " " + Component.translatable("screen.anglertackle.cookbook.source.oil",
                            OilPressingRecipe.LEAN_CHUNKS, OilPressingRecipe.OILY_CHUNKS).getString();
                }
                break;
            }
        }
        if (text == null) {
            text = Component.translatable("screen.anglertackle.cookbook.source_none",
                    item.getDescription().getString()).getString();
        }
        SOURCE_CACHE.put(item, text);
        return text;
    }

    /** 配方类型 id 的路径部分（{@code minecraft:smelting} → {@code smelting}）。 */
    private static String typeOf(Recipe<?> recipe) {
        return BuiltInRegistries.RECIPE_TYPE.getKey(recipe.getType()).getPath();
    }

    /** 配方在哪做（按类型名给语言键）。 */
    private static String station(String recipeId, Recipe<?> recipe) {
        String path = recipeId.substring(recipeId.indexOf(':') + 1);
        String type = typeOf(recipe);
        String key = switch (type) {
            case "crafting_shaped", "crafting_shapeless" -> "crafting";
            case "smelting" -> "furnace";
            case "smoking" -> "smoker";
            case "campfire_cooking" -> "campfire";
            case "blasting" -> "blast_furnace";
            case "stonecutting" -> "stonecutter";
            case "oil_pressing" -> "oil_pressing";
            case "cutting" -> "cutting";
            default -> null;
        };
        // 认不出来的类型（别的 mod 的机器）就直接显示配方 id —— 显示原始 id 也比显示错的中文好
        return key == null ? path
                : Component.translatable("screen.anglertackle.cookbook.station." + key).getString();
    }

    /** 配料来源的缓存（每帧都查一遍配方管理器太重）。 */
    private static final Map<Item, String> SOURCE_CACHE = new HashMap<>();

    // ---------------------------------------------------------------- 效果

    /** 「效果」页：饱食度 + 三档效果 + 两条注意。 */
    private List<Line> effectLines(String dishId, int width) {
        List<Line> out = new ArrayList<>();
        out.add(new Line(Component.translatable("screen.anglertackle.cookbook.hunger",
                FoodValues.dishHunger(FoodValues.MIN_TIER),
                FoodValues.dishHunger(FoodValues.MAX_TIER)).getString(), C_TEXT));
        out.add(new Line("", C_TEXT));
        int[] tiers = {0, 2, DishEffects.SUPREME_TIER};
        for (int tier : tiers) {
            String label = Component.translatable(
                    "screen.anglertackle.cookbook.tier." + tier).getString();
            String summary = effectSummary(dishId, tier);
            String text = summary.isEmpty()
                    ? label + "：" + Component.translatable("tooltip.anglertackle.dish_no_effect").getString()
                    : label + "：" + summary;
            // 档位标签按**该档品质色**上色（白/蓝/金）—— 与 tooltip、图鉴同一套；
            // 没有效果的那一档压暗，好让"这三档里哪档真的有东西"一眼看出来
            out.add(new Line(text, summary.isEmpty() ? C_DIM : Quality.of(tier).argb()));
        }
        out.addAll(palatabilityLines(dishId));
        out.add(new Line("", C_TEXT));
        out.add(new Line(Component.translatable("screen.anglertackle.cookbook.note1").getString(), C_DIM));
        out.add(new Line(Component.translatable("screen.anglertackle.cookbook.note2").getString(), C_DIM));
        return out;
    }

    /** 味道提示用的红（⚠ 那一行）。**不是**档位色 —— 档位色只有一个真源 Quality，见 check-tooltip-colors.js。 */
    private static final int C_WARN = 0xFFFF5555;

    /**
     * 「味道」：这些鱼做成这道菜会不会有负面（L0~L5，依据见 docs/料理适配策划案.md）。
     *
     * <p>用户 2026-10-11："加 debuff 提示在悬浮文本和菜谱"。
     *
     * <p>⚠⚠ 文案**来自 {@code FishPalatability.warningKey}** —— 它与悬浮文本、
     * 与**真正发效果**的那处共用同一个 {@code biteOf}。这里**不许**再写一份
     * "哪条鱼有什么负面"的表（docs/29 的纪律：界面自己抄表 = 迟早与机制分叉，
     * 出现"菜谱说没事、吃了反胃"这种谎话）。
     *
     * <p>菜谱是**按菜型**讲的（一道菜对应多条鱼），所以按"负面种类"分组，各自列出是哪几条鱼；
     * 鱼清单从 {@link DishRecipe#allowedPairs()} 现取 —— 与「做法」页那份鱼清单**同一个来源**。
     * 一道菜涉及的所有鱼都没事（L0/L1）时**一行都不加**，于是那一页与改动前**逐字一致**。
     */
    private List<Line> palatabilityLines(String dishId) {
        List<Line> out = new ArrayList<>();
        boolean raw = "sashimi".equals(dishId);   // 刺身是唯一走生料的菜型（与真正发效果那处同一判据）
        java.util.Map<String, List<String>> byKey = new java.util.LinkedHashMap<>();
        for (DishRecipe.Pair pair : DishRecipe.allowedPairs()) {
            if (!pair.dish().id().equals(dishId)) {
                continue;
            }
            String key = com.whitecobalt.anglertackle.recipe.FishPalatability.warningKey(pair.species(), raw);
            if (key == null) {
                continue;
            }
            byKey.computeIfAbsent(key, (k) -> new ArrayList<>())
                    .add(Component.translatable("item.anglertackle." + pair.species()).getString());
        }
        if (byKey.isEmpty()) {
            return out;
        }
        out.add(new Line("", C_TEXT));
        for (java.util.Map.Entry<String, List<String>> e : byKey.entrySet()) {
            out.add(new Line(Component.translatable(e.getKey()).getString()
                    + "：" + String.join("、", e.getValue()), C_WARN));
        }
        return out;
    }

    private String effectSummary(String dishId, int tier) {
        List<String> parts = new ArrayList<>();
        for (DishEffects.Grant g : DishEffects.grantsFor(dishId, tier)) {
            parts.add(EffectText.line(g).getString());
        }
        return String.join("、", parts);
    }

    // ---------------------------------------------------------------- 小工具

    private static String section(String key) {
        return Component.translatable("screen.anglertackle.cookbook.section." + key).getString() + "：";
    }

    /** 这道菜能用哪些鱼（工作台菜来自配方表；设备菜是"任意鱼块"）。 */
    private String fishList(String dishId) {
        if (dishOf(dishId) == null) {
            return Component.translatable("screen.anglertackle.cookbook.any_chunk").getString();
        }
        List<String> species = new ArrayList<>();
        for (DishRecipe.Pair pair : DishRecipe.allowedPairs()) {
            if (pair.dish().id().equals(dishId)) {
                species.add(Component.translatable("item.anglertackle." + pair.species()).getString());
            }
        }
        return String.join("、", species) + "（" + species.size() + "）";
    }

    /** 菜名：复用配方书的模板 {@code dish.anglertackle.<id>}（带一个 %s），参数给"鱼"。 */
    private static String dishName(String dishId) {
        return Component.translatable("dish.anglertackle." + dishId,
                Component.translatable("screen.anglertackle.cookbook.generic_fish")).getString();
    }

    private static DishRecipe.Dish dishOf(String dishId) {
        for (DishRecipe.Dish d : DishRecipe.Dish.values()) {
            if (d.id().equals(dishId)) {
                return d;
            }
        }
        return null;
    }

    @Override
    public void extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float partialTick) {
        int left = (this.width - panelW) / 2;
        int top = (this.height - panelH) / 2;
        g.fill(left - 6, top - 6, left + panelW + 6, top + panelH + 6, C_SHADOW);
        g.fill(left - 4, top - 4, left + panelW + 4, top + panelH + 4, C_PANEL);
        // 选中行高亮（两栏各自的高亮 y 由 rebuild 记下）
        int colX = selectedCol == 0 ? LIST_COL0 : LIST_COL1;
        g.fill(left + colX - 2, top + selectedRowY, left + DETAIL_X - 12,
                top + selectedRowY + ROW_H, C_SELECT);
        g.fill(left + DETAIL_X - 8, top + 6, left + DETAIL_X - 7, top + panelH - 6, C_LINE);
        super.extractRenderState(g, mouseX, mouseY, partialTick);
    }

    @Override
    public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
        double mouseX = event.x();
        double mouseY = event.y();
        int button = event.button();
        int left = (this.width - panelW) / 2;
        int top = (this.height - panelH) / 2;
        int perCol = Math.max(1, Math.min(visibleRows, (dishes.size() + 1) / 2));
        for (int i = 0; i < dishes.size() - scroll && i < perCol * 2; i++) {
            int col = i / perCol;
            int row = i % perCol;
            int x = left + (col == 0 ? LIST_COL0 : LIST_COL1);
            int y = top + LIST_Y + row * ROW_H;
            if (mouseX >= x - 2 && mouseX <= x + (DETAIL_X - LIST_COL1 - 6)
                    && mouseY >= y && mouseY <= y + ROW_H) {
                selected = dishes.get(i + scroll);
                rebuild();
                return true;
            }
        }
        return super.mouseClicked(event, doubleClick);
    }

    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double scrollX, double scrollY) {
        if (scrollY != 0) {
            scroll -= (int) Math.signum(scrollY);
            rebuild();
            return true;
        }
        return super.mouseScrolled(mouseX, mouseY, scrollX, scrollY);
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }

    private void addText(int x, int y, String text, int width, int color) {
        addRenderableWidget(new TextWidget(x, y, width, LINE_H, UiLayout.fitText(text, width),
                color, true, 0, 0));
    }

    private record Line(String text, int color) {
    }
}
