package com.whitecobalt.anglertackle.compat.kaleidoscope;

import com.github.ysbbbbbb.kaleidoscopecookery.api.blockentity.IStockpot;
import com.github.ysbbbbbb.kaleidoscopecookery.api.event.StockpotMatchRecipeEvent;
import com.github.ysbbbbbb.kaleidoscopecookery.crafting.container.StockpotInput;
import com.github.ysbbbbbb.kaleidoscopecookery.crafting.recipe.FlexStockpotRecipe;
import com.github.ysbbbbbb.kaleidoscopecookery.crafting.recipe.StockpotRecipe;
import com.github.ysbbbbbb.kaleidoscopecookery.crafting.recipe.StockpotVisuals;
import com.github.ysbbbbbb.kaleidoscopecookery.init.ModRecipes;
import com.whitecobalt.anglertackle.fishing.FishChunkData;
import com.whitecobalt.anglertackle.fishing.FishData;
import com.whitecobalt.anglertackle.fishing.FoodValues;
import com.whitecobalt.anglertackle.item.DishItem;
import com.whitecobalt.anglertackle.registry.ModDataComponents;
import net.minecraft.core.NonNullList;
import net.minecraft.core.component.DataComponents;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.item.crafting.RecipeHolder;
import net.minecraft.world.level.Level;
import org.jetbrains.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;

/**
 * 汤锅数据保真 —— 用他们的汤锅煮出来的我们那道菜，必须**带那条鱼的鱼种与档位**。
 *
 * <h2>⚠ 为什么必须在 {@code Pre} 里、而且要自己匹配一遍</h2>
 * 他们的 {@code StockpotBlockEntity.setRecipe(Level)} 顺序是（javap 逐条读出来的）：
 * <pre>
 *   StockpotInput input = getInput();
 *   post(Pre)                     ← 只有这里能改结果：Pre.getOutput() != null 就 applyRecipe 并结束
 *   if (quickCheck 命中) applyRecipe(非 flex 配方)
 *   post(Post)                    ← 已经晚了：flex 还没匹配
 *   if (flexQuickCheck 命中) applyRecipe(flex 配方)   ← **最后落地的永远是这一条**
 * </pre>
 * 我们的兼容配方全是 {@code flex_stockpot}（汤底自由），所以挂在 {@code Post} 上等于没挂，
 * 而 {@code Pre} 里 {@code getOutput()} 又是**空的** —— 只能自己用他们的 RecipeManager 匹配一遍。
 *
 * <h2>⚠⚠ 1.4.2 的崩溃教训：FlexStockpotRecipe **不是** StockpotRecipe 的子类</h2>
 * 两者都 {@code implements BaseRecipe<StockpotInput>}、都从 {@code java.lang.Record} 继承，
 * 只是**凑巧字段一样**（ingredients / soupBase / result / time / carrier / visuals）。
 * 我第一版写了 {@code (StockpotRecipe) holder.value()} —— 匹配到 flex 配方时直接
 * {@code ClassCastException}，而这段代码跑在**他们的方块实体 tick 里**，于是整个服务端崩了
 * （crash-2026-10-04_17.14.50-server.txt）。所以现在：
 * ① 两个类型**分别 instanceof 分支**取字段，再拼一个 {@code StockpotRecipe} 交给他们；
 * ② 整个处理器**包在 try/catch 里** —— 兼容层再出错也只能是"这道菜没数据"，
 * 绝不允许它把玩家的世界弄崩。
 *
 * <h2>静默边界</h2>
 * 只有"配方产物是**我们的菜**（{@link DishItem}）"且"锅里能找到我们的鱼/鱼块"两条同时成立才接管；
 * 任一不成立就立刻返回。找不到带数据的来源时**不猜** —— 宁可让菜保持无数据（按优质档兜底），
 * 也不给错档位。
 */
final class StockpotTakeover {

    private static final Logger LOGGER = LoggerFactory.getLogger("AnglerTackle/Kaleidoscope");

    private StockpotTakeover() {
    }

    /**
     * "这一口锅现在煮的是哪条鱼" —— 接管成功那一刻记下来，出锅时用。
     *
     * <h2>为什么非要记（1.4.8 的日志证据）</h2>
     * ```
     * 已接管：flex_stockpot/creamy_fish_soup_raw ← juvenile_shark 档位 4
     * 右键汤锅：status=3 成品=creamy_fish_soup 带数据=否 锅里=（空）
     * ```
     * 汤锅**一开始煮就把料清空了**（不像炒锅会留着），所以出锅时"读锅里找鱼"必然读到空 ——
     * 而我们构造的那份带数据配方显然也没能活到出锅（成品那份是无数据的）。
     * 那就别指望它：接管成功时把鱼记在**我们自己的小表**里，出锅时按坐标取回来。
     * 表很小、用完即删（上限 {@link #REMEMBER_MAX} 条，防地图上乱摆的锅把内存撑起来）。
     */
    private static final int REMEMBER_MAX = 64;

    record PotKey(String dim, long pos) {
    }

    static final java.util.Map<PotKey, FishChunkData> REMEMBERED =
            new java.util.LinkedHashMap<>(16, 0.75f, false) {
                @Override
                protected boolean removeEldestEntry(java.util.Map.Entry<PotKey, FishChunkData> eldest) {
                    return size() > REMEMBER_MAX;
                }
            };

    static PotKey keyOf(Level level, net.minecraft.core.BlockPos pos) {
        return new PotKey(level.dimension().location().toString(), pos.asLong());
    }

    /** 记下"这个位置现在做的是哪条鱼"（蒸笼也用同一本账）。 */
    static void remember(Level level, net.minecraft.core.BlockPos pos, FishChunkData data) {
        REMEMBERED.put(keyOf(level, pos), data);
    }

    /** 取回并**不**删除（取出替换失败时要留着下次还能用）。 */
    static FishChunkData recall(Level level, net.minecraft.core.BlockPos pos) {
        return REMEMBERED.get(keyOf(level, pos));
    }

    /** 用完即删。 */
    static void forget(Level level, net.minecraft.core.BlockPos pos) {
        REMEMBERED.remove(keyOf(level, pos));
    }

    /** 一个栈里带的鱼数据（鱼块优先，其次整鱼）——蒸笼放料时用它认"这是我们的鱼"。 */
    static FishChunkData dataOf(ItemStack stack) {
        FishChunkData chunk = stack.get(ModDataComponents.FISH_CHUNK.get());
        if (chunk != null) {
            return chunk;
        }
        FishData fish = stack.get(ModDataComponents.FISH_DATA.get());
        return fish == null ? null : new FishChunkData(fish.speciesId(), fish.effectiveTier(), fish.weightKg());
    }

    /** 诊断计数：只打前几条就够定位，绝不允许每 tick 刷屏。 */
    private static int debugLeft = 20;

    private static void debug(String msg) {
        if (debugLeft-- > 0) {
            LOGGER.info("垂纶／汤锅：{}", msg);
        }
    }

    private static String ids(java.util.List<ItemStack> items) {
        StringBuilder sb = new StringBuilder();
        for (ItemStack s : items) {
            if (sb.length() > 0) sb.append(" + ");
            sb.append(s.getCount()).append('x').append(s.getItem());
        }
        return sb.length() == 0 ? "（空）" : sb.toString();
    }

    /** 出锅诊断：右键汤锅时把"锅里的成品里到底有没有鱼数据"打出来（前 6 条）。 */
    static void onRightClickBlock(net.neoforged.neoforge.event.entity.player.PlayerInteractEvent.RightClickBlock event) {
        try {
            Level level = event.getLevel();
            if (level.isClientSide()) {
                return;
            }
            if (!(level.getBlockEntity(event.getPos())
                    instanceof com.github.ysbbbbbb.kaleidoscopecookery.blockentity.kitchen.StockpotBlockEntity pot)) {
                return;
            }
            // ⚠⚠ 只管**盛菜**这一下（用户 2026-10-04 报的锅盖问题）：
            //   同一个右键还兼着"取下/盖上锅盖"，上一版只要锅里有成品就抢，结果锅盖被我们代跑掉了 ——
            //   东西到手了、方块状态却没更新（方块的锅盖还在）。
            //   判据收紧成两条：① 手里拿着**碗**（我们配方的 carrier 就是碗，盛菜必须手持碗）；
            //   ② 锅的状态是 FINISHED（用他们 API 的常量，别再写死数字 —— 我上一版写 2，
            //      而 IStockpot 里 FINISHED 其实是 3）。
            if (!event.getItemStack().is(net.minecraft.world.item.Items.BOWL)
                    || pot.getStatus() != IStockpot.FINISHED) {
                return;
            }
            if (debugLeft <= 0) {
                return;
            }
            ItemStack out = pot.getResult();
            FishChunkData data = out.get(ModDataComponents.FISH_CHUNK.get());
            StringBuilder sb = new StringBuilder();
            for (ItemStack in : pot.getInputs()) {
                if (in.isEmpty()) continue;
                if (sb.length() > 0) sb.append(" + ");
                sb.append(in.getCount()).append('x').append(in.getItem());
            }
            debug("右键汤锅：status=" + pot.getStatus() + " 成品=" + out.getItem()
                + " 带数据=" + (data == null ? "否" : ("是(" + data.speciesId() + " 档位 " + data.tier() + ")"))
                + " 锅里=" + (sb.length() == 0 ? "（空）" : sb));

            // 出锅替换：把盛出来那一份换成带数据的。数据来源按优先级：
            //   ① 锅里那份成品自带的（最好，说明配方接管活到了出锅）
            //   ② 接管成功时记下来的那条鱼（汤锅一开始煮就清空料，只能靠记）
            if (!(out.getItem() instanceof DishItem)) {
                return;
            }
            FishChunkData fromPot = out.get(ModDataComponents.FISH_CHUNK.get());
            var player0 = (net.minecraft.world.entity.player.Player) event.getEntity();
            FishChunkData remembered = REMEMBERED.get(keyOf(level, event.getPos()));
            FishChunkData use = fromPot != null ? fromPot : remembered;
            if (use == null) {
                debug("出锅替换跳过：成品无数据，且这张桌子上没有我们记过的鱼");
                return;
            }
            ItemStack withData = out.copy();
            withData.set(ModDataComponents.FISH_CHUNK.get(), use);
            withData.set(DataComponents.FOOD, FoodValues.dish(use.tier()));
            // ⚠ 必须**先取消**他们自己的出锅：否则他们的逻辑也会跑一遍 takeOutProduct，
            //   两次出锅在"第一次成功、第二次也成功"的边缘上就是一个复制口子。
            event.setCanceled(true);
            ItemStack[] before = Reclaim.snapshot(player0);
            if (!pot.takeOutProduct(level, player0, event.getItemStack())) {
                event.setCanceled(false);            // 他们自己来（手里没拿碗之类）
                return;
            }
            if (Reclaim.swapProduct(level, player0, event.getPos(), before, out.getItem(), withData)) {
                REMEMBERED.remove(keyOf(level, event.getPos()));   // 用完即删
                debug("出锅替换成功：" + use.speciesId() + " 档位 " + use.tier()
                    + "（数据来源：" + (fromPot != null ? "锅内成品" : "接管时记下的鱼") + "）");
            } else {
                debug("出锅替换失败：找不到刚出现的那一份（玩家拿到无数据版）");
            }
        } catch (Throwable t) {
            LOGGER.warn("垂纶：汤锅诊断跳过（{}）", t.toString());
        }
    }

    static void onPre(StockpotMatchRecipeEvent.Pre event) {
        try {
            apply(event);
        } catch (Throwable t) {
            // 兼容层的底线：出错就"什么都不改"，让他们用自己那份无数据的配方继续跑
            LOGGER.warn("垂纶：汤锅数据保真跳过（{}）—— 这道菜会按优质档兜底结算", t.toString());
        }
    }

    private static void apply(StockpotMatchRecipeEvent.Pre event) {
        Level level = event.getLevel();
        if (level.isClientSide()) {
            return;                                  // 只在服务端改配方，客户端由同步跟过来
        }
        StockpotInput input = event.getInput();
        FishChunkData data = findOurFish(input.getInputs());
        if (data == null) {
            // ⚠ 1.4.3 之前这里还有一条"event.getOutput() != null 就不抢"的守卫 ——
            //   他们的 Pre 事件带着上一次匹配的成品，于是我们**每次都静默跳过**。
            //   我们要的本来就是覆盖它，所以守卫删掉了。
            debug("锅里没有我们的鱼：" + ids(input.getInputs()));
            return;                                  // 没有来源就不猜档位，菜保持无数据
        }
        // ⚠ 这里**故意**不写"每 tick 只能接管一次"的守卫（1.5.3 曾试过、已撤回）：
        //   他们的 setRecipe 确实是每 tick 都调，但"每 tick setOutput 一个新配方实例"**并不会**
        //   卡住烹饪 —— 用户 2026-10-05 实测 1.5.2 能正常煮开（那次"一直停在准备阶段"是**火关了**）。
        //   留个教训：报"煮不熟"先问一句火/盖子，再怀疑自己的代码。
        var hit = level.getRecipeManager().getRecipeFor(ModRecipes.FLEX_STOCKPOT_RECIPE, input, level);
        if (hit.isEmpty()) {
            debug("锅里有我们的鱼，但 flex_stockpot 没匹配到配方：" + ids(input.getInputs()));
            return;
        }
        RecipeHolder<?> holder = hit.get();
        StockpotRecipe replacement = withData(holder, data);
        if (replacement != null) {
            event.setOutput(new RecipeHolder<>(holder.id(), replacement));
            var be = event.getStockpot();
            REMEMBERED.put(keyOf(level, be.getBlockPos()), data);
            debug("已接管：" + holder.id() + " ← " + data.speciesId() + " 档位 " + data.tier());
        } else {
            debug("匹配到的不是我们的菜：" + holder.id());
        }
    }

    /**
     * 照抄配方、只换 result。两个配方类**分别分支**（它们没有继承关系，见类注释）。
     *
     * @return 不是我们的菜 / 类型不认识 → null（调用方据此不改任何东西）
     */
    @Nullable
    private static StockpotRecipe withData(RecipeHolder<?> holder, FishChunkData data) {
        Object value = holder.value();
        NonNullList<Ingredient> ingredients;
        ResourceLocation soupBase;
        ItemStack result;
        int time;
        Ingredient carrier;
        StockpotVisuals visuals;
        if (value instanceof StockpotRecipe r) {
            ingredients = r.ingredients();
            soupBase = r.soupBase();
            result = r.result();
            time = r.time();
            carrier = r.carrier();
            visuals = r.visuals();
        } else if (value instanceof FlexStockpotRecipe r) {
            ingredients = r.ingredients();
            soupBase = r.soupBase();
            result = r.result();
            time = r.time();
            carrier = r.carrier();
            visuals = r.visuals();
        } else {
            return null;
        }
        if (!(result.getItem() instanceof DishItem)) {
            return null;                             // 不是我们的菜
        }
        ItemStack withData = result.copy();
        withData.set(ModDataComponents.FISH_CHUNK.get(), data);
        withData.set(DataComponents.FOOD, FoodValues.dish(data.tier()));
        return new StockpotRecipe(ingredients, soupBase, withData, time, carrier, visuals);
    }

    /**
     * 锅里（含汤底槽）找我们的鱼：鱼块优先用它自己带的档位，整鱼用 {@code effectiveTier()}。
     * 都没有就返回 null —— 上层据此**放弃接管**（不猜档位）。
     */
    @Nullable
    private static FishChunkData findOurFish(List<ItemStack> inputs) {
        for (ItemStack stack : inputs) {
            FishChunkData chunk = stack.get(ModDataComponents.FISH_CHUNK.get());
            if (chunk != null) {
                return chunk;
            }
            FishData fish = stack.get(ModDataComponents.FISH_DATA.get());
            if (fish != null) {
                return new FishChunkData(fish.speciesId(), fish.effectiveTier(), fish.weightKg());
            }
        }
        return null;
    }
}
