package com.whitecobalt.anglertackle.fish;

/*
 * ⚠ 本文件由 tools/gen-fish-model.js **整份生成**，不要手工修改。
 *   数据源：tools/fish-appearance.json（每种鱼的 shape/颜色）+ tools/fish-model.js（几何与 UV 装箱）
 *   重新生成：node tools/gen-fish-model.js
 */

import java.util.HashMap;
import java.util.Map;

/**
 * 21 种鱼的**尺寸**表：渲染缩放与碰撞箱。
 *
 * <p>形状不在这里 —— 形状是每种鱼一套网格，见 {@code ModFishModel}；这里只放"多大"。
 *
 * <p>数字由 tools/fish-model.js 从真实体长算出：
 * <pre>
 *   目标模型长度 = 2.98 × 体长(cm)^0.48      （1 模型单位 = 1/16 格）
 *   缩放         = 目标长度 / 该鱼自己的模型全长
 * </pre>
 * 0.48 次方把 25 倍的真实体长差压成 4.2 倍尺寸差；只此一处归一，不再额外压缩。
 *
 * <p><b>碰撞箱和缩放同源</b>：手写尺寸表的坑是"模型放大了判定框没跟着动"，
 * 表现是鱼比自己的判定框大一圈、用桶捞会捞到空气。
 */
public final class FishVariants {

    /**
     * @param sx/sy/sz 渲染缩放（见 ModFishRenderer.scale）
     * @param hitW/hitH 实体碰撞箱宽×高（格）
     * @param centerZ 模型 z 方向的中点（模型单位，1 格 = 16）——
     *                鱼模型的 z 原点在头身交界而不是鱼的中心，摆到方块上要用它居中
     */
    public record Variant(float sx, float sy, float sz, float hitW, float hitH, float centerZ) {
    }

    private static final Map<String, Variant> BY_SPECIES = new HashMap<>();

    private static final Variant FALLBACK = new Variant(1.0F, 1.0F, 1.0F, 0.6F, 0.35F, 0.0F);

    static {
        BY_SPECIES.put("tilapia", new Variant(1.096F, 0.913F, 0.913F, 0.68F, 0.34F, 3.5F));
        BY_SPECIES.put("african_butterflyfish", new Variant(0.786F, 0.655F, 0.655F, 0.49F, 0.25F, 3.5F));
        BY_SPECIES.put("crucian_carp", new Variant(1.004F, 0.837F, 0.837F, 0.63F, 0.31F, 3.5F));
        BY_SPECIES.put("mirror_carp", new Variant(0.889F, 0.741F, 0.741F, 0.93F, 0.32F, 9.5F));
        BY_SPECIES.put("jewel_cichlid", new Variant(0.817F, 0.68F, 0.68F, 0.51F, 0.26F, 3.5F));
        BY_SPECIES.put("mullet", new Variant(0.7F, 0.7F, 0.7F, 0.88F, 0.31F, 9.5F));
        BY_SPECIES.put("zander", new Variant(0.884F, 0.884F, 0.884F, 1.11F, 0.39F, 9.5F));
        BY_SPECIES.put("atlantic_salmon", new Variant(1.422F, 1.422F, 1.422F, 1.78F, 0.62F, 9.5F));
        BY_SPECIES.put("bluefin_tuna", new Variant(1.516F, 1.516F, 1.516F, 1.9F, 0.66F, 9.5F));
        BY_SPECIES.put("brown_trout", new Variant(0.741F, 0.741F, 0.741F, 0.93F, 0.32F, 9.5F));
        BY_SPECIES.put("tigerfish", new Variant(0.916F, 0.916F, 0.916F, 1.15F, 0.4F, 9.5F));
        BY_SPECIES.put("topmouth_culter", new Variant(0.779F, 0.779F, 0.779F, 0.97F, 0.34F, 9.5F));
        BY_SPECIES.put("hemiculter", new Variant(0.628F, 0.628F, 0.628F, 0.47F, 0.24F, 3.5F));
        BY_SPECIES.put("striped_bass", new Variant(0.953F, 0.953F, 0.953F, 1.19F, 0.42F, 9.5F));
        BY_SPECIES.put("platinum_arowana", new Variant(0.741F, 0.741F, 0.741F, 0.93F, 0.32F, 9.5F));
        BY_SPECIES.put("oxeye_tarpon", new Variant(1.087F, 1.087F, 1.087F, 1.36F, 0.48F, 9.5F));
        BY_SPECIES.put("banded_loach", new Variant(0.539F, 0.485F, 0.539F, 0.4F, 0.2F, 3.5F));
        BY_SPECIES.put("guppy", new Variant(0.464F, 0.386F, 0.386F, 0.3F, 0.2F, 3.5F));
        BY_SPECIES.put("elephantnose", new Variant(0.931F, 0.931F, 0.931F, 0.7F, 0.35F, 3.5F));
        BY_SPECIES.put("golden_loach", new Variant(0.796F, 0.796F, 0.796F, 0.6F, 0.3F, 3.5F));
        BY_SPECIES.put("cave_blindfish", new Variant(0.57F, 0.57F, 0.57F, 0.43F, 0.21F, 3.5F));
        BY_SPECIES.put("grass_carp", new Variant(0.916F, 0.916F, 0.916F, 1.15F, 0.4F, 9.5F));
        BY_SPECIES.put("black_carp", new Variant(1.034F, 1.034F, 1.034F, 1.29F, 0.45F, 9.5F));
        BY_SPECIES.put("pike", new Variant(0.916F, 0.916F, 0.916F, 1.15F, 0.4F, 9.5F));
        BY_SPECIES.put("arapaima", new Variant(1.516F, 1.516F, 1.516F, 1.9F, 0.66F, 9.5F));
        BY_SPECIES.put("north_african_catfish", new Variant(1.034F, 1.034F, 1.034F, 1.29F, 0.45F, 9.5F));
        BY_SPECIES.put("sapphire_snakehead", new Variant(0.895F, 0.895F, 0.895F, 0.67F, 0.34F, 3.5F));
        BY_SPECIES.put("juvenile_shark", new Variant(1.061F, 1.061F, 1.061F, 1.33F, 0.46F, 9.5F));
        BY_SPECIES.put("arctic_char", new Variant(0.816F, 0.816F, 0.816F, 1.02F, 0.36F, 9.5F));
        BY_SPECIES.put("whitefish", new Variant(0.741F, 0.741F, 0.741F, 0.93F, 0.32F, 9.5F));
        BY_SPECIES.put("rainbow_trout", new Variant(0.851F, 0.851F, 0.851F, 1.06F, 0.37F, 9.5F));
        BY_SPECIES.put("burbot", new Variant(1.418F, 1.418F, 1.418F, 1.06F, 0.53F, 3.5F));
        BY_SPECIES.put("taimen", new Variant(1.087F, 1.087F, 1.087F, 1.36F, 0.48F, 9.5F));
        BY_SPECIES.put("arctic_cod", new Variant(0.931F, 0.931F, 0.931F, 0.7F, 0.35F, 3.5F));
        BY_SPECIES.put("capelin", new Variant(0.437F, 0.437F, 0.437F, 0.55F, 0.2F, 9.5F));
        BY_SPECIES.put("atlantic_herring", new Variant(0.61F, 0.61F, 0.61F, 0.76F, 0.27F, 9.5F));
        BY_SPECIES.put("wolffish", new Variant(1.812F, 1.812F, 1.812F, 1.36F, 0.68F, 3.5F));
        BY_SPECIES.put("redfish", new Variant(1.482F, 1.235F, 1.235F, 0.93F, 0.46F, 3.5F));
        BY_SPECIES.put("sablefish", new Variant(1.812F, 1.812F, 1.812F, 1.36F, 0.68F, 3.5F));
        BY_SPECIES.put("atlantic_cod", new Variant(1.812F, 1.812F, 1.812F, 1.36F, 0.68F, 3.5F));
        BY_SPECIES.put("greenland_halibut", new Variant(2.373F, 1.978F, 1.978F, 1.48F, 0.74F, 3.5F));
        BY_SPECIES.put("greenland_shark", new Variant(1.516F, 1.516F, 1.516F, 1.9F, 0.66F, 9.5F));
        BY_SPECIES.put("sailfish", new Variant(1.587F, 1.587F, 1.587F, 1.98F, 0.69F, 9.5F));
        BY_SPECIES.put("mahi_mahi", new Variant(1.233F, 1.233F, 1.233F, 1.54F, 0.54F, 9.5F));
        BY_SPECIES.put("alligator_gar", new Variant(2.1F, 2.1F, 2.1F, 1.58F, 0.79F, 3.5F));
        BY_SPECIES.put("giant_siamese_carp", new Variant(2.1F, 2.1F, 2.1F, 1.58F, 0.79F, 3.5F));
        BY_SPECIES.put("electric_eel", new Variant(1.812F, 1.812F, 1.812F, 1.36F, 0.68F, 3.5F));
    }

    public static Variant of(String speciesId) {
        Variant v = speciesId == null ? null : BY_SPECIES.get(speciesId);
        return v == null ? FALLBACK : v;
    }

    private FishVariants() {
    }
}
