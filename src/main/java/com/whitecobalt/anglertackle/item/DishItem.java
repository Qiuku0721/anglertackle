package com.whitecobalt.anglertackle.item;

import com.whitecobalt.anglertackle.effect.DishEffects;
import com.whitecobalt.anglertackle.effect.EffectText;
import com.whitecobalt.anglertackle.fishing.FishChunkData;
import com.whitecobalt.anglertackle.recipe.DishRecipe;
import com.whitecobalt.anglertackle.registry.ModDataComponents;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;

import java.util.List;

/**
 * 成品菜（12 道"菜型"共用的物品类）。
 *
 * <p>见 docs/25 §14.3 规则①：成品菜**按"菜型"注册**（一件物品一张图），
 * "哪条鱼、什么档位、多重"全在数据组件里 —— 否则 23 条鱼 × 每种做法 = 上百个物品。
 * 所以这个类做三件事：
 * <ul>
 *   <li>能吃（饱食度/饱和度由注册时的属性给，最终按档位走：普通 4 / 优质 6 / 顶级 8）；</li>
 *   <li>**名字带上鱼种**：{@code 红烧草鱼}，而不是笼统的"红烧鱼" ——
 *       用户 2026-10-03："配方显示模糊，什么鱼都可以做菜"，所以配方和产物都要能一眼看出是哪条鱼；</li>
 *   <li>tooltip 说清这道菜是什么、用哪条鱼做的（文案在语言文件里，不在 Java 里）。</li>
 * </ul>
 *
 * <p>⚠ 贴图来自用户给的参考图（`参考资料/菜品贴图/`，抠图流程见
 * `build/subagent-out/cutout.js` + `tools/build-dish-icons.js`）。
 */
public class DishItem extends Item {

    private final String id;
    private final String tooltipKey;
    /** 带鱼种的名字模板，例如 {@code dish.anglertackle.braised_fish} = "红烧%s"。 */
    private final String nameKey;

    /**
     * @param id         物品 id（同时是语言键中段：{@code tooltip.anglertackle.<id>} /
     *                   {@code dish.anglertackle.<id>}）
     * @param properties 物品属性（含 food(...)）
     */
    public DishItem(String id, Properties properties) {
        super(properties);
        this.id = id;
        this.tooltipKey = "tooltip.anglertackle." + id;
        this.nameKey = "dish.anglertackle." + id;
    }

    /** 菜型 id（如 {@code sashimi}）—— 吃菜给效果时用它查映射表（docs/28）。 */
    public String dishId() {
        return id;
    }

    /**
     * 吃完一道菜 → 给对应的效果（策划 docs/28，用户 2026-10-03 定案）。
     *
     * <p>放在这里而不是 {@code use(...)}：1.21 的食物消耗走
     * {@code Item#finishUsingItem}，在这之前玩家可能中途打断（松开右键），
     * 那时不该给效果。
     */
    @Override
    public ItemStack finishUsingItem(ItemStack stack, net.minecraft.world.level.Level level,
                                     net.minecraft.world.entity.LivingEntity entity) {
        ItemStack result = super.finishUsingItem(stack, level, entity);
        if (!level.isClientSide() && entity instanceof net.minecraft.world.entity.player.Player player) {
            com.whitecobalt.anglertackle.effect.DishEffects.apply(player, stack);
            // 食用适宜度（L0~L5，依据见 docs/料理适配策划案.md）——
            // **只对非零等级生效**：L0/L1 的鱼走的是"一条效果都不发"那条老路，行为与改动前逐字一致。
            // "生"只判刺身：Dish.SASHIMI 是唯一 Base.RAW 的菜型（其余不是熟块就是整条下锅）。
            com.whitecobalt.anglertackle.recipe.FishPalatability.apply(
                    player, stack, "sashimi".equals(dishId()));
            // 称号「美食家 / 百无禁忌」：吃进肚子里的那一刻才算（用户要的是"吃下过"）——
            // 菜型取 dishId() 的枚举序，适口等级取这条鱼在 FishPalatability 表里的档位。
            if (player instanceof net.minecraft.server.level.ServerPlayer sp) {
                try {
                    com.whitecobalt.anglertackle.recipe.DishRecipe.Dish d =
                            com.whitecobalt.anglertackle.recipe.DishRecipe.Dish.byId(dishId());
                    if (d != null) {
                        com.whitecobalt.anglertackle.title.Titles.setBit(sp,
                                com.whitecobalt.anglertackle.title.Titles.K_DISH_EATEN, d.ordinal());
                    }
                    com.whitecobalt.anglertackle.fishing.FishChunkData cd =
                            stack.get(com.whitecobalt.anglertackle.registry.ModDataComponents.FISH_CHUNK.get());
                    if (cd != null) {
                        int palat = com.whitecobalt.anglertackle.recipe.FishPalatability.of(cd.speciesId());
                        com.whitecobalt.anglertackle.title.Titles.setBit(sp,
                                com.whitecobalt.anglertackle.title.Titles.K_PALAT, palat);
                    }
                    com.whitecobalt.anglertackle.title.Titles.syncAuto(sp);
                } catch (Throwable t) {
                    com.whitecobalt.anglertackle.AnglersTackle.LOGGER
                            .warn("[垂纶] 吃菜计数失败（已忽略）：{}", t.toString());
                }
            }
        }
        return result;
    }

    /**
     * 做出一道菜的**唯一信号**（称号「鱼宴大厨」要"10 种菜型各做过一次"）。
     *
     * <p>为什么挂 {@code onCraftedBy}：菜是**工作台配方**（{@code DishRecipe}，无序合成）产出的，
     * 原版取走成品时 {@code ResultSlot.checkTakeAchievements} 会调它 ⇒ 这里拿得到玩家 ✓。
     * 挂在 {@code DishRecipe.assemble} 上拿不到玩家（配方只认输入），挂在物品的
     * {@code use}/吃上又变成"吃到才算做过"（与条件不符 ✗）。
     */
    @Override
    public void onCraftedBy(ItemStack stack, net.minecraft.world.level.Level level,
                            net.minecraft.world.entity.player.Player player) {
        super.onCraftedBy(stack, level, player);
        if (level.isClientSide() || !(player instanceof net.minecraft.server.level.ServerPlayer sp)) {
            return;
        }
        try {
            com.whitecobalt.anglertackle.recipe.DishRecipe.Dish d =
                    com.whitecobalt.anglertackle.recipe.DishRecipe.Dish.byId(dishId());
            if (d != null) {
                com.whitecobalt.anglertackle.title.Titles.setBit(sp,
                        com.whitecobalt.anglertackle.title.Titles.K_DISH_MADE, d.ordinal());
                com.whitecobalt.anglertackle.title.Titles.syncAuto(sp);
            }
        } catch (Throwable t) {
            com.whitecobalt.anglertackle.AnglersTackle.LOGGER
                    .warn("[垂纶] 做菜计数失败（已忽略）：{}", t.toString());
        }
    }

    /**
     * 有 {@link FishChunkData} 就显示成"红烧草鱼"，没有（创造模式直接拿出来的）就退回物品本名。
     *
     * <p>这条同时决定了**配方书 / JEI 里那一格写什么** ——
     * {@code DishRecipe#getResultItem} 返回的就是带组件的栈。
     */
    @Override
    public Component getName(ItemStack stack) {
        FishChunkData data = stack.get(ModDataComponents.FISH_CHUNK.get());
        if (data == null) {
            return super.getName(stack);
        }
        return Component.translatable(nameKey,
                Component.translatable("item.anglertackle." + data.speciesId()));
    }

    /**
     * 悬浮显示：这道菜是什么、用哪条鱼做的、**吃了会得到什么效果、各多久**。
     *
     * <h2>为什么要写清效果与时长（2026-10-03 用户）</h2>
     * 用户原话："现在的问题是玩家不知道烹饪成品有什么效果持续时间多久。"
     * 效果数值是 docs/28 定案的，但玩家在游戏里看不到 —— 一道"红烧草鱼"到底是
     * 6 分钟渔运 II 还是 30 秒速度，只能靠吃一次试试。
     *
     * <h2>数字从哪来</h2>
     * <b>不抄策划表</b>，直接调 {@link DishEffects#grantsFor}（吃菜时用的就是它），
     * 所以悬浮显示与实际吃到的效果**在结构上不可能不一致**。
     *
     * <h2>三行结构</h2>
     * <ol>
     *   <li>当前档位真的会给的效果（蓝色，与原版药水一致）；一条都没有就直说"无额外效果"；</li>
     *   <li>金/红档（顶级）**另外**会多出来的效果（暗灰）—— 这是最有用的一条：
     *       玩家能一眼看出"这条鱼太小了，换条金档的还能多拿一个效果"；</li>
     *   <li>没有鱼数据（创造模式/JEI 直接拿的）时什么都不写，只说效果取决于鱼。</li>
     * </ol>
     */
    @Override
    public void appendHoverText(ItemStack stack, Item.TooltipContext context,
                                List<Component> lines, TooltipFlag flag) {
        lines.add(Component.translatable(tooltipKey).withStyle(ChatFormatting.GRAY));
        FishChunkData data = stack.get(ModDataComponents.FISH_CHUNK.get());
        if (data == null) {
            // 创造模式/JEI 直拿的菜没有鱼数据：给不了具体数值，就说清"取决于哪条鱼"
            lines.add(Component.translatable("tooltip.anglertackle.dish_no_data")
                    .withStyle(ChatFormatting.DARK_GRAY));
            return;
        }
        // ★ 材料档次那一小段必须**按真实档位着色**（2026-10-03 用户："自查所有悬浮显示，
        //   如出现顶级鱼等该显示颜色的文本却是白色，就改一下"）。
        //   原来这里写死 GRAY，于是"顶级"和"普通"看起来一模一样 ——
        //   而模组的约定是"颜色 = 品质"（图鉴、配件、鱼的 tooltip 都是这么做的）。
        lines.add(Component.translatable("item.anglertackle." + data.speciesId())
                .withStyle(ChatFormatting.WHITE)
                .append(Component.literal(" · ").withStyle(ChatFormatting.DARK_GRAY))
                .append(Component.translatable("tooltip.anglertackle.chunk_group."
                        + FishChunkData.groupOfTier(data.tier()))
                        .withStyle(Quality.of(data.tier()).color())));

        // ---- ⓪ 配料有"同类替代"时说一句（docs/30 §4.1）----
        //   名字**从标签现算**：装了森罗物语就多出「油脂」，没装就只有「鱼油」。
        java.util.List<String> subs = new java.util.ArrayList<>();
        DishRecipe.Dish dishType = DishRecipe.Dish.byId(id);
        if (dishType != null) {
            for (int i = 0; i < dishType.extraItems().size(); i++) {
                if (dishType.hasSubstitute(i)) {
                    subs.add(String.join(" / ", dishType.substituteNames(i)));
                }
            }
        }
        if (!subs.isEmpty()) {
            lines.add(Component.translatable("tooltip.anglertackle.dish_substitute",
                    String.join("、", subs)).withStyle(ChatFormatting.DARK_GRAY));
        }

        // ---- ① 这道菜在这个档位实际会给的效果 ----
        List<DishEffects.Grant> grants = DishEffects.grantsFor(id, data.tier());
        if (grants.isEmpty()) {
            lines.add(Component.translatable("tooltip.anglertackle.dish_no_effect")
                    .withStyle(ChatFormatting.DARK_GRAY));
        } else {
            lines.add(Component.translatable("tooltip.anglertackle.dish_effects")
                    .withStyle(ChatFormatting.GRAY));
            for (DishEffects.Grant g : grants) {
                lines.add(EffectText.line(g).withStyle(ChatFormatting.BLUE));
            }
        }

        // ---- ② 顶级（金/红）另外能多拿到的效果 ----
        // 只列"当前档位没有的那些效果"，不列同一个效果的高等级版本 ——
        // 后者是**替换**不是新增，混在一起会让人以为能叠。
        if (data.tier() < DishEffects.SUPREME_TIER) {
            List<DishEffects.Grant> extra = new java.util.ArrayList<>();
            for (DishEffects.Grant g : DishEffects.grantsFor(id, DishEffects.SUPREME_TIER)) {
                boolean already = grants.stream().anyMatch((have) -> have.effect().equals(g.effect()));
                if (!already) {
                    extra.add(g);
                }
            }
            if (!extra.isEmpty()) {
                lines.add(Component.translatable("tooltip.anglertackle.dish_supreme_extra")
                        .withStyle(ChatFormatting.GRAY));
                for (DishEffects.Grant g : extra) {
                    lines.add(EffectText.line(g).withStyle(ChatFormatting.DARK_GRAY));
                }
            }
        }

        // ---- ③ 味道：这条鱼做成这道菜，吃下去会不会有负面（L0~L5，docs/料理适配策划案.md）----
        //   ⚠ 文案**来自 FishPalatability.warningKey**（和真正发效果用的是同一个 biteOf）——
        //     界面自己抄一张"哪条鱼有什么负面"的表，迟早会出现"悬浮写着没事、吃了反胃"
        //     （docs/29 那条纪律，check-cookbook.js 的 cookbook-hover-own-numbers 就守它）。
        //   L0/L1 的鱼返回 null ⇒ 这一行**根本不出现**，于是那些菜的悬浮文本与改动前逐字一致。
        String palatWarn = com.whitecobalt.anglertackle.recipe.FishPalatability.warningKey(
                data.speciesId(), "sashimi".equals(id));
        if (palatWarn != null) {
            lines.add(Component.translatable(palatWarn).withStyle(ChatFormatting.RED));
        }
        // 慢性风险（汞/雪卡/二噁英）：**吃够几次**这个数字从 PalatabilityLedger.THRESHOLD 现取，
        // 不许写死在文案里 —— 写死就成了第二个真源，调阈值时悬浮文本立刻开始撒谎。
        String chronic = com.whitecobalt.anglertackle.recipe.FishPalatability.chronicKey(data.speciesId());
        if (chronic != null) {
            lines.add(Component.translatable(chronic,
                            com.whitecobalt.anglertackle.recipe.PalatabilityLedger.THRESHOLD)
                    .withStyle(ChatFormatting.DARK_RED));
        }
    }
}
