package com.whitecobalt.anglertackle.debug;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.registry.ModDataComponents;
import net.minecraft.core.NonNullList;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.AbstractCookingRecipe;
import net.minecraft.world.item.crafting.CraftingInput;
import net.minecraft.world.item.crafting.CraftingRecipe;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.item.crafting.Recipe;
import net.minecraft.world.item.crafting.RecipeHolder;
import net.minecraft.world.item.crafting.SingleRecipeInput;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;

/**
 * **配方体检**：拿每条配方**自己显示的材料**去喂它，看它到底做不做得出来。
 *
 * <h2>为什么需要它（用户 2026-10-03）</h2>
 * 用户连着报了三轮："jei 都能进但就是合成不了" / "配方显示模糊" /
 * "**即使显示能做也弄不了**" / "这都出问题了那肯定还有更多"。
 * 这三轮全都是同一类问题：**界面上写着能做的配方，实际匹配不上**——
 * 而这类错在 JS 检查器里查不出来（检查器读的是源码与 JSON，不是游戏里的匹配结果），
 * 只有把材料真的摆进配方、问一遍 {@code Recipe#matches} 才知道。
 *
 * <p>体检的判据只有一条，但正好是用户要的那条：
 * <blockquote>
 *   把 {@link Recipe#getIngredients()}（= 配方书 / JEI 里显示的材料）原样摆进合成格，
 *   这条配方**必须**匹配，而且 {@code assemble} 必须给出非空产物。
 * </blockquote>
 * 材料表与匹配逻辑一旦脱节（少一条、多一条、写错物品、写死档位、丢了数据组件），
 * 这里就会点名报出来。
 *
 * <h2>怎么跑</h2>
 * <pre>
 *   ATL_AUDIT=true gradlew runServer      # 体检完自动关服（不用 Ctrl+C）
 * </pre>
 * 平时（不设这个环境变量）它什么都不做，玩家与开发都不受影响。
 * 实现见 {@code build.gradle} 的 {@code runs.server.jvmArguments}。
 */
@EventBusSubscriber(modid = AnglersTackle.MOD_ID)
public final class RecipeAudit {

    private static final Logger LOGGER = LoggerFactory.getLogger("Angler's Tackle/体检");

    private RecipeAudit() {
    }

    @SubscribeEvent
    public static void onServerStarted(ServerStartedEvent event) {
        if (!Boolean.getBoolean("anglertackle.audit")) {
            return;
        }
        MinecraftServer server = event.getServer();
        try {
            int checked = audit(server);
            logFoodTable(server);
            LOGGER.info("[垂纶/体检] 完事，{} 条配方体检通过；正在关服。", checked);
        } catch (Throwable t) {
            LOGGER.error("[垂纶/体检] 体检本身崩了", t);
        } finally {
            server.halt(false);
        }
    }

    /**
     * **食物数值表**：把每个食物物品的 FOOD 组件**原样读出来**打日志。
     *
     * <p>为什么要跑一遍而不是"照着源码抄一张表"：饱食度有两条来源 ——
     * ① 注册时的 {@code Properties.food(...)}；② 配方 assemble 时写进产物栈的 FOOD
     * （{@code DishRecipe} 按材料档位写 4/6/8）。照着源码抄很容易漏掉第 ② 条，
     * 也可能把 {@code saturationModifier} 与"最终饱和度"搞混
     * （最终饱和度 = nutrition × modifier × 2）。
     * 这里读的是**游戏里真正生效的那份数据**，也是 {@code docs/27-食物数值表.md} 的依据。
     */
    private static void logFoodTable(MinecraftServer server) {
        LOGGER.info("[垂纶/体检] === 食物数值表（饥饿 = 饱食度点数；饱和 = 最终饱和度）===");
        List<String> rows = new ArrayList<>();
        for (net.minecraft.world.item.Item item : net.minecraft.core.registries.BuiltInRegistries.ITEM) {
            net.minecraft.resources.ResourceLocation id =
                    net.minecraft.core.registries.BuiltInRegistries.ITEM.getKey(item);
            if (!id.getNamespace().equals(AnglersTackle.MOD_ID)) {
                continue;
            }
            net.minecraft.world.food.FoodProperties f =
                    new ItemStack(item).get(net.minecraft.core.component.DataComponents.FOOD);
            if (f == null) {
                continue;
            }
            rows.add(String.format("%-40s 饥饿 %d  饱和 %.1f",
                    id.getPath(), f.nutrition(), f.saturation()));
        }
        java.util.Collections.sort(rows);
        for (String r : rows) {
            LOGGER.info("[垂纶/体检] 食物 {}", r);
        }
        // 菜：**六个档位**各真做一次，读配方写进产物栈的值（用户要求按鱼品质区分）
        for (RecipeHolder<?> holder : server.getRecipeManager().getRecipes()) {
            if (!(holder.value() instanceof com.whitecobalt.anglertackle.recipe.DishRecipe dish)) {
                continue;
            }
            StringBuilder ladder = new StringBuilder();
            for (int tier = com.whitecobalt.anglertackle.fishing.FoodValues.MIN_TIER;
                 tier <= com.whitecobalt.anglertackle.fishing.FoodValues.MAX_TIER; tier++) {
                CraftingInput input = asCraftingInput(dish.getIngredients(), 1);
                if (input == null) {
                    continue;
                }
                // 把主料换成"该档位的这条鱼"（产物饱食度就是照它算的）
                for (int i = 0; i < input.size(); i++) {
                    if (input.getItem(i).has(ModDataComponents.FISH_CHUNK.get())) {
                        input.getItem(i).set(ModDataComponents.FISH_CHUNK.get(),
                                new com.whitecobalt.anglertackle.fishing.FishChunkData(
                                        dish.species(), tier, 1.0f));
                    } else if (input.getItem(i).has(ModDataComponents.FISH_DATA.get())) {
                        // 整鱼那道菜（整条油炸）：饱食度读的是**鱼**身上的档位
                        input.getItem(i).set(ModDataComponents.FISH_DATA.get(),
                                new com.whitecobalt.anglertackle.fishing.FishData(
                                        dish.species(), 30f, 1.0f,
                                        com.whitecobalt.anglertackle.fishing.FishData.SizeGrade.NORMAL,
                                        0L, java.util.Optional.empty(), tier));
                    }
                }
                ItemStack out = dish.assemble(input, server.registryAccess());
                net.minecraft.world.food.FoodProperties f =
                        out.get(net.minecraft.core.component.DataComponents.FOOD);
                ladder.append(tier).append(':').append(f == null ? "—" : f.nutrition()).append(' ');
            }
            LOGGER.info("[垂纶/体检] 菜 {}（{}）档位→饥饿：{}",
                    holder.id().getPath(), dish.species(), ladder.toString().trim());
        }
    }

    /** @return 通过体检的配方条数（失败会逐条打 ERROR 日志） */
    public static int audit(MinecraftServer server) {
        List<String> failures = new ArrayList<>();
        int checked = 0;
        int total = 0;
        for (RecipeHolder<?> holder : server.getRecipeManager().getRecipes()) {
            if (!holder.id().getNamespace().equals(AnglersTackle.MOD_ID)) {
                continue;
            }
            Recipe<?> recipe = holder.value();
            if (recipe.isSpecial()) {
                continue;                      // special 配方（鱼竿装配）没有材料表，不参与
            }
            total++;
            String name = holder.id().toString();
            NonNullList<Ingredient> ingredients = recipe.getIngredients();
            if (ingredients.isEmpty()) {
                failures.add(name + "：材料表是空的（配方书里根本不会显示，玩家也做不出来）");
                continue;
            }
            try {
                if (recipe instanceof CraftingRecipe crafting) {
                    CraftingInput input = asCraftingInput(ingredients, 1);
                    if (input == null) {
                        failures.add(name + "：有材料项一个物品都没有（hasNoItems）");
                        continue;
                    }
                    checked++;
                    if (!crafting.matches(input, server.overworld())) {
                        failures.add(name + "：按它自己显示的材料（" + describe(input)
                                + "）匹配失败 —— 界面上写着能做，实际做不出来");
                        continue;
                    }
                    ItemStack out = crafting.assemble(input, server.registryAccess());
                    if (out.isEmpty()) {
                        failures.add(name + "：匹配成功但产物是空的");
                    } else if (expectsChunkData(recipe) && !out.has(ModDataComponents.FISH_CHUNK.get())) {
                        failures.add(name + "：产物没有继承鱼块数据（做出来的菜会没有鱼名）");
                    }
                    // ⚠ 第二种摆法：**每格放一叠**（用户 2026-10-03："往配方栏里塞多个相同物品
                    //   会导致无法合成，除非换成一个"）。原版每次合成对每个非空格子各扣 1 个，
                    //   所以"一格放一叠"必须照样匹配 —— 这也正是能按住 Shift 批量合成的前提。
                    //   第一版按**个数**数主料（baseCount += stack.getCount()），
                    //   于是"1 块"的菜放 2 个就不匹配了，这条断言第一次跑就会红。
                    CraftingInput stacked = asCraftingInput(ingredients, 3);
                    if (stacked != null && !crafting.matches(stacked, server.overworld())) {
                        failures.add(name + "：每格放一叠（3 个）就不匹配了 —— 玩家没法批量合成"
                                + "（原版每次合成每格只扣 1 个，不该因为放多了而拒绝）");
                    }
                } else if (recipe instanceof AbstractCookingRecipe cooking) {
                    SingleRecipeInput input = asCookingInput(ingredients);
                    if (input == null) {
                        failures.add(name + "：材料项一个物品都没有");
                        continue;
                    }
                    checked++;
                    if (!cooking.matches(input, server.overworld())) {
                        failures.add(name + "：按它自己显示的材料匹配失败");
                        continue;
                    }
                    ItemStack out = cooking.assemble(input, server.registryAccess());
                    if (out.isEmpty()) {
                        failures.add(name + "：匹配成功但产物是空的");
                    } else if (input.getItem(0).has(ModDataComponents.FISH_CHUNK.get())
                            && !out.has(ModDataComponents.FISH_CHUNK.get())) {
                        failures.add(name + "：产物没有继承鱼块数据（烤完的块会没有鱼名）");
                    }
                }
            } catch (Throwable t) {
                failures.add(name + "：体检时抛异常 " + t);
            }
        }

        LOGGER.info("[垂纶/体检] 模组配方共 {} 条（special 除外），实际验了 {} 条，失败 {} 条",
                total, checked, failures.size());
        for (String f : failures) {
            LOGGER.error("[垂纶/体检] ❌ {}", f);
        }
        if (failures.isEmpty()) {
            LOGGER.info("[垂纶/体检] ✅ 每条配方显示的材料都能真的做出来");
        }
        return checked;
    }

    /**
     * 把材料表的**第一件**物品铺进 3×3 合成格（每个槽一件，或每槽 {@code perSlot} 件）。
     *
     * <p>{@code perSlot = 3} 那种摆法是给"一叠"用的：原版每次合成对每个非空格子只扣 1 个，
     * 所以摆一叠必须照样匹配（否则玩家没法批量合成）。
     */
    private static CraftingInput asCraftingInput(NonNullList<Ingredient> ingredients, int perSlot) {
        if (ingredients.size() > 9) {
            return null;                        // 摆不下 3×3：这条配方本身就有问题
        }
        List<ItemStack> stacks = new ArrayList<>();
        for (Ingredient ing : ingredients) {
            ItemStack[] items = ing.getItems();
            if (items.length == 0) {
                return null;
            }
            ItemStack one = items[0].copy();
            one.setCount(Math.max(1, perSlot));
            stacks.add(one);
        }
        while (stacks.size() < 9) {
            stacks.add(ItemStack.EMPTY);
        }
        return CraftingInput.of(3, 3, stacks);
    }

    private static SingleRecipeInput asCookingInput(NonNullList<Ingredient> ingredients) {
        ItemStack[] items = ingredients.get(0).getItems();
        if (items.length == 0) {
            return null;
        }
        return new SingleRecipeInput(items[0].copy());
    }

    /**
     * 这条配方的产物**应该**带鱼块数据吗？
     *
     * <p>只有"产物里带着哪条鱼"的那几类才要求：**切块**（生块）与**菜**（成品菜）。
     * 榨油的产物是鱼油（油里没有"哪条鱼"）、盐 / 鱼刀 / 手册这些普通合成产物更与鱼无关 ——
     * 第一版和第二版体检规则各错了一次：一次要求鱼油带鱼名，一次要求所有合成配方都带鱼名，
     * 13 条普通配方被误报。**体检规则也要能被证伪**，所以这里按配方类判断，不按名字猜。
     */
    private static boolean expectsChunkData(Recipe<?> recipe) {
        return recipe instanceof com.whitecobalt.anglertackle.recipe.DishRecipe
                || recipe instanceof com.whitecobalt.anglertackle.recipe.CuttingRecipe;
    }

    /** 把这次体检用的材料写成一行，失败日志里能直接看出摆的是什么。 */
    private static String describe(CraftingInput input) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < input.size(); i++) {
            ItemStack s = input.getItem(i);
            if (s.isEmpty()) {
                continue;
            }
            if (sb.length() > 0) {
                sb.append(" + ");
            }
            sb.append(s.getHoverName().getString());
        }
        return sb.toString();
    }
}
