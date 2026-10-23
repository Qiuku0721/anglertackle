package com.whitecobalt.anglertackle.client.model;

/*
 * ⚠ 本文件由 tools/gen-fish-model.js **整份生成**，不要手工修改。
 *   数据源：tools/fish-appearance.json（每种鱼的 shape/颜色）+ tools/fish-model.js（几何与 UV 装箱）
 *   重新生成：node tools/gen-fish-model.js
 */

import com.whitecobalt.anglertackle.client.render.state.FishRenderState;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import net.minecraft.client.model.EntityModel;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.model.geom.PartPose;
import net.minecraft.client.model.geom.builders.CubeListBuilder;
import net.minecraft.client.model.geom.builders.LayerDefinition;
import net.minecraft.client.model.geom.builders.MeshDefinition;
import net.minecraft.client.model.geom.builders.PartDefinition;
import net.minecraft.util.Mth;

/**
 * 通用鱼模型 —— 21 种鱼，**一种鱼一层**。
 *
 * <p>每层的零件表（盒子尺寸、姿态、texOffs、图集尺寸）都是
 * {@code tools/gen-fish-model.js} 从该鱼的 shape 参数算出来的，手写不出来：
 * texOffs 是货架装箱的结果，抄错一个数字的表现是"鱼身上出现别的零件的颜色"，
 * 不报错、只难看。
 *
 * <p><b>为什么是一种鱼一层而不是四组共用</b>：上一版 4 组共用网格、组内靠三轴缩放，
 * 用户的反馈是「模板套用很严重」「看不出狗鱼与其他鱼的那种明显的外形区别」。
 * 缩放改不了形状 —— 吻型、尾型、鳍的位置与长度都必须真的不同。
 * 21 个小组网格的代价可以忽略（原版有几百个模型层）。
 *
 * <p><b>朝向约定</b>：吻端在 -Z，尾在 +Z，体轴在 y = 24 - 体高/2 - 1
 * （抬高 1 格是为了给向下的臀鳍留位置，让鱼的最低点正好落在 y=24 的"地面"上）。
 */
public class ModFishModel extends EntityModel<FishRenderState> {

    /**
     * 会摆动的零件名。不同鱼种的尾型不同（叉尾/圆尾/新月尾/歪尾），
     * 构造时按鱼种挑出实际存在的那几个 —— 不存在的零件 getChild 会抛异常。
     */
    private static final String[] TAIL_PARTS = {
            "tail_fork_up", "tail_fork_lo", "tail_round",
            "tail_crescent_up", "tail_crescent_lo",
            "tail_hetero_up", "tail_hetero_lo",
    };

    private static final String[] EMPTY = new String[0];

    private final List<ModelPart> tails = new ArrayList<>();

    public ModFishModel(ModelPart root, String species) {
        super(root);
        for (String name : TAILS.getOrDefault(species, EMPTY)) {
            this.tails.add(root.getChild(name));
        }
    }

    /**
     * 鱼种 id → 网格。
     *
     * <p>图集尺寸必须和 {@code gen-fish-textures.js} 画出来的 PNG 完全一致 ——
     * 不一致的表现是 UV 整体错位（鱼身上出现别的零件的颜色），不报错。
     * 两边都从同一份 {@code fish-model.js} 结果读，所以不会走散。
     */
    public static LayerDefinition createBodyLayer(String species) {
        MeshDefinition mesh = new MeshDefinition();
        PartDefinition root = mesh.getRoot();
        switch (species) {
            case "tilapia" -> build_tilapia(root);
            case "african_butterflyfish" -> build_african_butterflyfish(root);
            case "crucian_carp" -> build_crucian_carp(root);
            case "mirror_carp" -> build_mirror_carp(root);
            case "jewel_cichlid" -> build_jewel_cichlid(root);
            case "mullet" -> build_mullet(root);
            case "zander" -> build_zander(root);
            case "atlantic_salmon" -> build_atlantic_salmon(root);
            case "bluefin_tuna" -> build_bluefin_tuna(root);
            case "brown_trout" -> build_brown_trout(root);
            case "tigerfish" -> build_tigerfish(root);
            case "topmouth_culter" -> build_topmouth_culter(root);
            case "hemiculter" -> build_hemiculter(root);
            case "striped_bass" -> build_striped_bass(root);
            case "platinum_arowana" -> build_platinum_arowana(root);
            case "oxeye_tarpon" -> build_oxeye_tarpon(root);
            case "banded_loach" -> build_banded_loach(root);
            case "guppy" -> build_guppy(root);
            case "elephantnose" -> build_elephantnose(root);
            case "golden_loach" -> build_golden_loach(root);
            case "cave_blindfish" -> build_cave_blindfish(root);
            case "grass_carp" -> build_grass_carp(root);
            case "black_carp" -> build_black_carp(root);
            case "pike" -> build_pike(root);
            case "arapaima" -> build_arapaima(root);
            case "north_african_catfish" -> build_north_african_catfish(root);
            case "sapphire_snakehead" -> build_sapphire_snakehead(root);
            case "juvenile_shark" -> build_juvenile_shark(root);
            case "arctic_char" -> build_arctic_char(root);
            case "whitefish" -> build_whitefish(root);
            case "rainbow_trout" -> build_rainbow_trout(root);
            case "burbot" -> build_burbot(root);
            case "taimen" -> build_taimen(root);
            case "arctic_cod" -> build_arctic_cod(root);
            case "capelin" -> build_capelin(root);
            case "atlantic_herring" -> build_atlantic_herring(root);
            case "wolffish" -> build_wolffish(root);
            case "redfish" -> build_redfish(root);
            case "sablefish" -> build_sablefish(root);
            case "atlantic_cod" -> build_atlantic_cod(root);
            case "greenland_halibut" -> build_greenland_halibut(root);
            case "greenland_shark" -> build_greenland_shark(root);
            case "sailfish" -> build_sailfish(root);
            case "mahi_mahi" -> build_mahi_mahi(root);
            case "alligator_gar" -> build_alligator_gar(root);
            case "giant_siamese_carp" -> build_giant_siamese_carp(root);
            case "electric_eel" -> build_electric_eel(root);
            default -> throw new IllegalArgumentException("未知鱼种：" + species);
        }
        return LayerDefinition.create(mesh, ATLAS_W.getOrDefault(species, 64), ATLAS_H.getOrDefault(species, 64));
    }

    /** tilapia —— 9 个零件，图集 64×16 */
    private static void build_tilapia(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.0F, -2.0F, 0.0F, 2.0F, 4.0F, 7.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(18, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("nose", CubeListBuilder.create().texOffs(46, 0).addBox(-1.0F, -2.0F, -1.0F, 2.0F, 3.0F, 1.0F), PartPose.offset(0.0F, 22.0F, -3.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(52, 0).addBox(0.0F, -1.0F, -1.0F, 0.0F, 1.0F, 3.0F), PartPose.offset(0.0F, 20.0F, 0.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(0, 11).addBox(-1.5F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(-1.0F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(58, 0).addBox(0.0F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(1.0F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(40, 0).addBox(0.0F, -1.6F, 0.0F, 0.0F, 1.6F, 3.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, 0.45F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(34, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.6F, 3.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, -0.45F, 0.0F, 0.0F));
        root.addOrReplaceChild("dorsal_long", CubeListBuilder.create().texOffs(28, 0).addBox(0.0F, -2.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 20.0F, 3.0F));
    }

    /** african_butterflyfish —— 9 个零件，图集 64×16 */
    private static void build_african_butterflyfish(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.0F, -2.0F, 0.0F, 2.0F, 4.0F, 7.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(30, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("nose", CubeListBuilder.create().texOffs(52, 0).addBox(-1.0F, -2.0F, -1.0F, 2.0F, 3.0F, 1.0F), PartPose.offset(0.0F, 22.0F, -3.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(58, 0).addBox(0.0F, -1.0F, -1.0F, 0.0F, 1.0F, 3.0F), PartPose.offset(0.0F, 20.0F, 0.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(6, 11).addBox(-1.5F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(-1.0F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(0, 11).addBox(0.0F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(1.0F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(46, 0).addBox(0.0F, -1.6F, 0.0F, 0.0F, 1.6F, 3.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, 0.45F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(40, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.6F, 3.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, -0.45F, 0.0F, 0.0F));
        root.addOrReplaceChild("dorsal_long", CubeListBuilder.create().texOffs(18, 0).addBox(0.0F, -2.0F, 0.0F, 0.0F, 2.0F, 6.0F), PartPose.offset(0.0F, 20.0F, 3.0F));
    }

    /** crucian_carp —— 9 个零件，图集 64×16 */
    private static void build_crucian_carp(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.0F, -2.0F, 0.0F, 2.0F, 4.0F, 7.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(18, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("nose", CubeListBuilder.create().texOffs(50, 0).addBox(-1.0F, -2.0F, -1.0F, 2.0F, 3.0F, 1.0F), PartPose.offset(0.0F, 22.0F, -3.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(36, 0).addBox(0.0F, -1.5F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(28, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(56, 0).addBox(0.0F, -1.0F, -1.0F, 0.0F, 1.0F, 3.0F), PartPose.offset(0.0F, 20.0F, 0.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(6, 11).addBox(-1.5F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(-1.0F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(0, 11).addBox(0.0F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(1.0F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
        root.addOrReplaceChild("dorsal_long", CubeListBuilder.create().texOffs(44, 0).addBox(0.0F, -2.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 20.0F, 3.0F));
    }

    /** mirror_carp —— 9 个零件，图集 64×32 */
    private static void build_mirror_carp(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("body2", CubeListBuilder.create().texOffs(22, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 8.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(44, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(0, 13).addBox(0.0F, -1.8F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(54, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(10, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 5.0F));
        root.addOrReplaceChild("top_fin2", CubeListBuilder.create().texOffs(16, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 7.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(29, 13).addBox(-1.6F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(-1.5F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(22, 13).addBox(0.0F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(1.5F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
    }

    /** jewel_cichlid —— 9 个零件，图集 64×16 */
    private static void build_jewel_cichlid(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.0F, -2.0F, 0.0F, 2.0F, 4.0F, 7.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(18, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("nose", CubeListBuilder.create().texOffs(46, 0).addBox(-1.0F, -2.0F, -1.0F, 2.0F, 3.0F, 1.0F), PartPose.offset(0.0F, 22.0F, -3.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(52, 0).addBox(0.0F, -1.0F, -1.0F, 0.0F, 1.0F, 3.0F), PartPose.offset(0.0F, 20.0F, 0.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(0, 11).addBox(-1.5F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(-1.0F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(58, 0).addBox(0.0F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(1.0F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(40, 0).addBox(0.0F, -1.6F, 0.0F, 0.0F, 1.6F, 3.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, 0.45F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(34, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.6F, 3.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, -0.45F, 0.0F, 0.0F));
        root.addOrReplaceChild("dorsal_long", CubeListBuilder.create().texOffs(28, 0).addBox(0.0F, -2.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 20.0F, 3.0F));
    }

    /** mullet —— 9 个零件，图集 64×32 */
    private static void build_mullet(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("body2", CubeListBuilder.create().texOffs(22, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 8.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(44, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(0, 13).addBox(0.0F, -1.8F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(54, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(10, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 5.0F));
        root.addOrReplaceChild("top_fin2", CubeListBuilder.create().texOffs(16, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 7.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(29, 13).addBox(-1.6F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(-1.5F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(22, 13).addBox(0.0F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(1.5F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
    }

    /** zander —— 10 个零件，图集 64×32 */
    private static void build_zander(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("body2", CubeListBuilder.create().texOffs(22, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 8.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(44, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(0, 13).addBox(0.0F, -1.8F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(54, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(16, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 5.0F));
        root.addOrReplaceChild("top_fin2", CubeListBuilder.create().texOffs(22, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 7.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(35, 13).addBox(-1.6F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(-1.5F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(28, 13).addBox(0.0F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(1.5F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
        root.addOrReplaceChild("dorsal2", CubeListBuilder.create().texOffs(10, 13).addBox(0.0F, -2.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 19.0F, 9.0F));
    }

    /** atlantic_salmon —— 9 个零件，图集 64×32 */
    private static void build_atlantic_salmon(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("body2", CubeListBuilder.create().texOffs(22, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 8.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(44, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(0, 13).addBox(0.0F, -1.8F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(54, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(10, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 5.0F));
        root.addOrReplaceChild("top_fin2", CubeListBuilder.create().texOffs(16, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 7.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(29, 13).addBox(-1.6F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(-1.5F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(22, 13).addBox(0.0F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(1.5F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
    }

    /** bluefin_tuna —— 9 个零件，图集 64×32 */
    private static void build_bluefin_tuna(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("body2", CubeListBuilder.create().texOffs(22, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 8.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(44, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(0, 13).addBox(0.0F, -1.8F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(54, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(10, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 5.0F));
        root.addOrReplaceChild("top_fin2", CubeListBuilder.create().texOffs(16, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 7.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(29, 13).addBox(-1.6F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(-1.5F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(22, 13).addBox(0.0F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(1.5F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
    }

    /** brown_trout —— 9 个零件，图集 64×32 */
    private static void build_brown_trout(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("body2", CubeListBuilder.create().texOffs(22, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 8.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(44, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(0, 13).addBox(0.0F, -1.8F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(54, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(10, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 5.0F));
        root.addOrReplaceChild("top_fin2", CubeListBuilder.create().texOffs(16, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 7.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(29, 13).addBox(-1.6F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(-1.5F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(22, 13).addBox(0.0F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(1.5F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
    }

    /** tigerfish —— 9 个零件，图集 64×32 */
    private static void build_tigerfish(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("body2", CubeListBuilder.create().texOffs(22, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 8.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(44, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(0, 13).addBox(0.0F, -1.8F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(54, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(10, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 5.0F));
        root.addOrReplaceChild("top_fin2", CubeListBuilder.create().texOffs(16, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 7.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(29, 13).addBox(-1.6F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(-1.5F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(22, 13).addBox(0.0F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(1.5F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
    }

    /** topmouth_culter —— 9 个零件，图集 64×32 */
    private static void build_topmouth_culter(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("body2", CubeListBuilder.create().texOffs(22, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 8.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(44, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(0, 13).addBox(0.0F, -1.8F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(54, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(10, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 5.0F));
        root.addOrReplaceChild("top_fin2", CubeListBuilder.create().texOffs(16, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 7.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(29, 13).addBox(-1.6F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(-1.5F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(22, 13).addBox(0.0F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(1.5F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
    }

    /** hemiculter —— 9 个零件，图集 64×16 */
    private static void build_hemiculter(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.0F, -2.0F, 0.0F, 2.0F, 4.0F, 7.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(18, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("nose", CubeListBuilder.create().texOffs(50, 0).addBox(-1.0F, -2.0F, -1.0F, 2.0F, 3.0F, 1.0F), PartPose.offset(0.0F, 22.0F, -3.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(36, 0).addBox(0.0F, -1.5F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(28, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(56, 0).addBox(0.0F, -1.0F, -1.0F, 0.0F, 1.0F, 3.0F), PartPose.offset(0.0F, 20.0F, 0.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(6, 11).addBox(-1.5F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(-1.0F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(0, 11).addBox(0.0F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(1.0F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
        root.addOrReplaceChild("dorsal_long", CubeListBuilder.create().texOffs(44, 0).addBox(0.0F, -2.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 20.0F, 3.0F));
    }

    /** striped_bass —— 9 个零件，图集 64×32 */
    private static void build_striped_bass(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("body2", CubeListBuilder.create().texOffs(22, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 8.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(44, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(0, 13).addBox(0.0F, -1.8F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(54, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(10, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 5.0F));
        root.addOrReplaceChild("top_fin2", CubeListBuilder.create().texOffs(16, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 7.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(29, 13).addBox(-1.6F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(-1.5F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(22, 13).addBox(0.0F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(1.5F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
    }

    /** platinum_arowana —— 9 个零件，图集 64×32 */
    private static void build_platinum_arowana(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("body2", CubeListBuilder.create().texOffs(22, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 8.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(44, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(0, 13).addBox(0.0F, -1.8F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(54, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(10, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 5.0F));
        root.addOrReplaceChild("top_fin2", CubeListBuilder.create().texOffs(16, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 7.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(29, 13).addBox(-1.6F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(-1.5F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(22, 13).addBox(0.0F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(1.5F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
    }

    /** oxeye_tarpon —— 9 个零件，图集 64×32 */
    private static void build_oxeye_tarpon(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("body2", CubeListBuilder.create().texOffs(22, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 8.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(44, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(0, 13).addBox(0.0F, -1.8F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(54, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(10, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 5.0F));
        root.addOrReplaceChild("top_fin2", CubeListBuilder.create().texOffs(16, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 7.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(29, 13).addBox(-1.6F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(-1.5F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(22, 13).addBox(0.0F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(1.5F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
    }

    /** banded_loach —— 9 个零件，图集 64×16 */
    private static void build_banded_loach(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.0F, -2.0F, 0.0F, 2.0F, 4.0F, 7.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(18, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("nose", CubeListBuilder.create().texOffs(50, 0).addBox(-1.0F, -2.0F, -1.0F, 2.0F, 3.0F, 1.0F), PartPose.offset(0.0F, 22.0F, -3.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(36, 0).addBox(0.0F, -1.5F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(28, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(56, 0).addBox(0.0F, -1.0F, -1.0F, 0.0F, 1.0F, 3.0F), PartPose.offset(0.0F, 20.0F, 0.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(6, 11).addBox(-1.5F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(-1.0F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(0, 11).addBox(0.0F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(1.0F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
        root.addOrReplaceChild("dorsal_long", CubeListBuilder.create().texOffs(44, 0).addBox(0.0F, -2.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 20.0F, 3.0F));
    }

    /** guppy —— 9 个零件，图集 64×16 */
    private static void build_guppy(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.0F, -2.0F, 0.0F, 2.0F, 4.0F, 7.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(28, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("nose", CubeListBuilder.create().texOffs(50, 0).addBox(-1.0F, -2.0F, -1.0F, 2.0F, 3.0F, 1.0F), PartPose.offset(0.0F, 22.0F, -3.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(56, 0).addBox(0.0F, -1.0F, -1.0F, 0.0F, 1.0F, 3.0F), PartPose.offset(0.0F, 20.0F, 0.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(6, 11).addBox(-1.5F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(-1.0F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(0, 11).addBox(0.0F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(1.0F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(44, 0).addBox(0.0F, -1.6F, 0.0F, 0.0F, 1.6F, 3.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, 0.45F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(38, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.6F, 3.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, -0.45F, 0.0F, 0.0F));
        root.addOrReplaceChild("dorsal_long", CubeListBuilder.create().texOffs(18, 0).addBox(0.0F, -2.0F, 0.0F, 0.0F, 2.0F, 5.0F), PartPose.offset(0.0F, 20.0F, 3.0F));
    }

    /** elephantnose —— 9 个零件，图集 64×16 */
    private static void build_elephantnose(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.0F, -2.0F, 0.0F, 2.0F, 4.0F, 7.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(18, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("nose", CubeListBuilder.create().texOffs(44, 0).addBox(-1.0F, -2.0F, -1.0F, 2.0F, 3.0F, 1.0F), PartPose.offset(0.0F, 22.0F, -3.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(36, 0).addBox(0.0F, -1.5F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(28, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(50, 0).addBox(0.0F, -1.0F, -1.0F, 0.0F, 1.0F, 3.0F), PartPose.offset(0.0F, 20.0F, 0.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(0, 11).addBox(-1.5F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(-1.0F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(56, 0).addBox(0.0F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(1.0F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
        root.addOrReplaceChild("barbel_1", CubeListBuilder.create().texOffs(6, 11).addBox(-0.5F, 0.0F, -1.0F, 1.0F, 1.0F, 1.0F), PartPose.offsetAndRotation(0.6F, 23.0F, -4.0F, 1.0F, -0.3F, 0.0F));
    }

    /** golden_loach —— 9 个零件，图集 64×16 */
    private static void build_golden_loach(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.0F, -2.0F, 0.0F, 2.0F, 4.0F, 7.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(18, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("nose", CubeListBuilder.create().texOffs(50, 0).addBox(-1.0F, -2.0F, -1.0F, 2.0F, 3.0F, 1.0F), PartPose.offset(0.0F, 22.0F, -3.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(36, 0).addBox(0.0F, -1.5F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(28, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(56, 0).addBox(0.0F, -1.0F, -1.0F, 0.0F, 1.0F, 3.0F), PartPose.offset(0.0F, 20.0F, 0.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(6, 11).addBox(-1.5F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(-1.0F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(0, 11).addBox(0.0F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(1.0F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
        root.addOrReplaceChild("dorsal_long", CubeListBuilder.create().texOffs(44, 0).addBox(0.0F, -2.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 20.0F, 3.0F));
    }

    /** cave_blindfish —— 9 个零件，图集 64×16 */
    private static void build_cave_blindfish(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.0F, -2.0F, 0.0F, 2.0F, 4.0F, 7.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(18, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("nose", CubeListBuilder.create().texOffs(52, 0).addBox(-1.0F, -2.0F, -1.0F, 2.0F, 3.0F, 1.0F), PartPose.offset(0.0F, 22.0F, -3.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(44, 0).addBox(0.0F, -1.5F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(36, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(58, 0).addBox(0.0F, -1.0F, -1.0F, 0.0F, 1.0F, 3.0F), PartPose.offset(0.0F, 20.0F, 0.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(6, 11).addBox(-1.5F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(-1.0F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(0, 11).addBox(0.0F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(1.0F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
        root.addOrReplaceChild("dorsal_long", CubeListBuilder.create().texOffs(28, 0).addBox(0.0F, -2.0F, 0.0F, 0.0F, 2.0F, 4.0F), PartPose.offset(0.0F, 20.0F, 3.0F));
    }

    /** grass_carp —— 9 个零件，图集 64×32 */
    private static void build_grass_carp(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("body2", CubeListBuilder.create().texOffs(22, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 8.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(44, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(0, 13).addBox(0.0F, -1.8F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(54, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(10, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 5.0F));
        root.addOrReplaceChild("top_fin2", CubeListBuilder.create().texOffs(16, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 7.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(29, 13).addBox(-1.6F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(-1.5F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(22, 13).addBox(0.0F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(1.5F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
    }

    /** black_carp —— 9 个零件，图集 64×32 */
    private static void build_black_carp(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("body2", CubeListBuilder.create().texOffs(22, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 8.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(44, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(0, 13).addBox(0.0F, -1.8F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(54, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(10, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 5.0F));
        root.addOrReplaceChild("top_fin2", CubeListBuilder.create().texOffs(16, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 7.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(29, 13).addBox(-1.6F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(-1.5F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(22, 13).addBox(0.0F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(1.5F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
    }

    /** pike —— 9 个零件，图集 64×32 */
    private static void build_pike(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("body2", CubeListBuilder.create().texOffs(22, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 8.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(44, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(0, 13).addBox(0.0F, -1.8F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(54, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(10, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 5.0F));
        root.addOrReplaceChild("top_fin2", CubeListBuilder.create().texOffs(16, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 7.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(29, 13).addBox(-1.6F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(-1.5F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(22, 13).addBox(0.0F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(1.5F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
    }

    /** arapaima —— 9 个零件，图集 64×32 */
    private static void build_arapaima(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("body2", CubeListBuilder.create().texOffs(22, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 8.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(44, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(0, 13).addBox(0.0F, -1.8F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(54, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(10, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 5.0F));
        root.addOrReplaceChild("top_fin2", CubeListBuilder.create().texOffs(16, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 7.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(29, 13).addBox(-1.6F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(-1.5F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(22, 13).addBox(0.0F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(1.5F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
    }

    /** north_african_catfish —— 10 个零件，图集 64×32 */
    private static void build_north_african_catfish(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("body2", CubeListBuilder.create().texOffs(22, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 8.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(0, 13).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(20, 13).addBox(0.0F, -1.8F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(10, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(30, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 5.0F));
        root.addOrReplaceChild("top_fin2", CubeListBuilder.create().texOffs(36, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 7.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(49, 13).addBox(-1.6F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(-1.5F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(42, 13).addBox(0.0F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(1.5F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
        root.addOrReplaceChild("dorsal_long", CubeListBuilder.create().texOffs(44, 0).addBox(0.0F, -2.0F, 0.0F, 0.0F, 2.0F, 6.0F), PartPose.offset(0.0F, 19.0F, 3.0F));
    }

    /** sapphire_snakehead —— 8 个零件，图集 64×16 */
    private static void build_sapphire_snakehead(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.0F, -2.0F, 0.0F, 2.0F, 4.0F, 7.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(18, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("nose", CubeListBuilder.create().texOffs(44, 0).addBox(-1.0F, -2.0F, -1.0F, 2.0F, 3.0F, 1.0F), PartPose.offset(0.0F, 22.0F, -3.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(36, 0).addBox(0.0F, -1.5F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(28, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(50, 0).addBox(0.0F, -1.0F, -1.0F, 0.0F, 1.0F, 3.0F), PartPose.offset(0.0F, 20.0F, 0.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(0, 11).addBox(-1.5F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(-1.0F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(56, 0).addBox(0.0F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(1.0F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
    }

    /** juvenile_shark —— 20 个零件，图集 64×32 */
    private static void build_juvenile_shark(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("body2", CubeListBuilder.create().texOffs(22, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 8.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(44, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("tail_hetero_up", CubeListBuilder.create().texOffs(0, 13).addBox(0.0F, -2.0F, 0.0F, 0.0F, 2.0F, 4.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, 0.42F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_hetero_lo", CubeListBuilder.create().texOffs(54, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 4.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, -0.58F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(12, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 5.0F));
        root.addOrReplaceChild("top_fin2", CubeListBuilder.create().texOffs(18, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 7.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(38, 19).addBox(-1.6F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(-1.5F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(31, 19).addBox(0.0F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(1.5F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
        root.addOrReplaceChild("gill_1", CubeListBuilder.create().texOffs(41, 13).addBox(-1.52F, -1.0F, -1.0F, 3.04F, 2.0F, 1.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("gill_2", CubeListBuilder.create().texOffs(50, 13).addBox(-1.52F, -1.0F, -2.0F, 3.04F, 2.0F, 1.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("gill_3", CubeListBuilder.create().texOffs(0, 19).addBox(-1.52F, -1.0F, -3.0F, 3.04F, 2.0F, 1.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("gill_4", CubeListBuilder.create().texOffs(9, 19).addBox(-1.52F, -1.0F, -4.0F, 3.04F, 2.0F, 1.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("gill_5", CubeListBuilder.create().texOffs(18, 19).addBox(-1.52F, -1.0F, -5.0F, 3.04F, 2.0F, 1.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("dorsal_a", CubeListBuilder.create().texOffs(27, 19).addBox(0.0F, -1.0F, 0.0F, 0.0F, 1.0F, 2.0F), PartPose.offset(0.0F, 19.0F, 2.0F));
        root.addOrReplaceChild("dorsal_b", CubeListBuilder.create().texOffs(37, 13).addBox(0.0F, -2.0F, 0.0F, 0.0F, 2.0F, 2.0F), PartPose.offset(0.0F, 19.0F, 4.0F));
        root.addOrReplaceChild("dorsal_c", CubeListBuilder.create().texOffs(24, 13).addBox(0.0F, -3.0F, 0.0F, 0.0F, 3.0F, 2.0F), PartPose.offset(0.0F, 19.0F, 6.0F));
        root.addOrReplaceChild("dorsal_d", CubeListBuilder.create().texOffs(8, 13).addBox(0.0F, -4.0F, 0.0F, 0.0F, 4.0F, 2.0F), PartPose.offset(0.0F, 19.0F, 8.0F));
        root.addOrReplaceChild("mouth_h", CubeListBuilder.create().texOffs(28, 13).addBox(-0.7F, 0.0F, -2.0F, 1.4F, 0.5F, 3.0F), PartPose.offset(0.0F, 23.5F, -1.0F));
        root.addOrReplaceChild("mouth_v", CubeListBuilder.create().texOffs(45, 19).addBox(-0.7F, 0.0F, -1.0F, 1.4F, 1.2F, 0.5F), PartPose.offset(0.0F, 22.3F, 2.0F));
    }

    /** arctic_char —— 9 个零件，图集 64×32 */
    private static void build_arctic_char(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("body2", CubeListBuilder.create().texOffs(22, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 8.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(44, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(0, 13).addBox(0.0F, -1.8F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(54, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(10, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 5.0F));
        root.addOrReplaceChild("top_fin2", CubeListBuilder.create().texOffs(16, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 7.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(29, 13).addBox(-1.6F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(-1.5F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(22, 13).addBox(0.0F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(1.5F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
    }

    /** whitefish —— 9 个零件，图集 64×32 */
    private static void build_whitefish(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("body2", CubeListBuilder.create().texOffs(22, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 8.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(44, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(0, 13).addBox(0.0F, -1.8F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(54, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(10, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 5.0F));
        root.addOrReplaceChild("top_fin2", CubeListBuilder.create().texOffs(16, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 7.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(29, 13).addBox(-1.6F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(-1.5F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(22, 13).addBox(0.0F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(1.5F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
    }

    /** rainbow_trout —— 9 个零件，图集 64×32 */
    private static void build_rainbow_trout(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("body2", CubeListBuilder.create().texOffs(22, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 8.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(44, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(0, 13).addBox(0.0F, -1.8F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(54, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(10, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 5.0F));
        root.addOrReplaceChild("top_fin2", CubeListBuilder.create().texOffs(16, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 7.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(29, 13).addBox(-1.6F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(-1.5F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(22, 13).addBox(0.0F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(1.5F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
    }

    /** burbot —— 8 个零件，图集 64×16 */
    private static void build_burbot(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.0F, -2.0F, 0.0F, 2.0F, 4.0F, 7.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(18, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("nose", CubeListBuilder.create().texOffs(44, 0).addBox(-1.0F, -2.0F, -1.0F, 2.0F, 3.0F, 1.0F), PartPose.offset(0.0F, 22.0F, -3.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(36, 0).addBox(0.0F, -1.5F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(28, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(50, 0).addBox(0.0F, -1.0F, -1.0F, 0.0F, 1.0F, 3.0F), PartPose.offset(0.0F, 20.0F, 0.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(0, 11).addBox(-1.5F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(-1.0F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(56, 0).addBox(0.0F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(1.0F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
    }

    /** taimen —— 9 个零件，图集 64×32 */
    private static void build_taimen(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("body2", CubeListBuilder.create().texOffs(22, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 8.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(44, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(0, 13).addBox(0.0F, -1.8F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(54, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(10, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 5.0F));
        root.addOrReplaceChild("top_fin2", CubeListBuilder.create().texOffs(16, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 7.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(29, 13).addBox(-1.6F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(-1.5F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(22, 13).addBox(0.0F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(1.5F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
    }

    /** arctic_cod —— 9 个零件，图集 64×16 */
    private static void build_arctic_cod(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.0F, -2.0F, 0.0F, 2.0F, 4.0F, 7.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(18, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("nose", CubeListBuilder.create().texOffs(52, 0).addBox(-1.0F, -2.0F, -1.0F, 2.0F, 3.0F, 1.0F), PartPose.offset(0.0F, 22.0F, -3.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(44, 0).addBox(0.0F, -1.5F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(36, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(58, 0).addBox(0.0F, -1.0F, -1.0F, 0.0F, 1.0F, 3.0F), PartPose.offset(0.0F, 20.0F, 0.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(6, 11).addBox(-1.5F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(-1.0F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(0, 11).addBox(0.0F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(1.0F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
        root.addOrReplaceChild("dorsal_long", CubeListBuilder.create().texOffs(28, 0).addBox(0.0F, -2.0F, 0.0F, 0.0F, 2.0F, 4.0F), PartPose.offset(0.0F, 20.0F, 3.0F));
    }

    /** capelin —— 9 个零件，图集 64×32 */
    private static void build_capelin(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("body2", CubeListBuilder.create().texOffs(22, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 8.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(44, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(0, 13).addBox(0.0F, -1.8F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(54, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(10, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 5.0F));
        root.addOrReplaceChild("top_fin2", CubeListBuilder.create().texOffs(16, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 7.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(29, 13).addBox(-1.6F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(-1.5F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(22, 13).addBox(0.0F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(1.5F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
    }

    /** atlantic_herring —— 9 个零件，图集 64×32 */
    private static void build_atlantic_herring(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("body2", CubeListBuilder.create().texOffs(22, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 8.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(44, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(0, 13).addBox(0.0F, -1.8F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(54, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(10, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 5.0F));
        root.addOrReplaceChild("top_fin2", CubeListBuilder.create().texOffs(16, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 7.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(29, 13).addBox(-1.6F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(-1.5F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(22, 13).addBox(0.0F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(1.5F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
    }

    /** wolffish —— 8 个零件，图集 64×16 */
    private static void build_wolffish(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.0F, -2.0F, 0.0F, 2.0F, 4.0F, 7.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(18, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("nose", CubeListBuilder.create().texOffs(44, 0).addBox(-1.0F, -2.0F, -1.0F, 2.0F, 3.0F, 1.0F), PartPose.offset(0.0F, 22.0F, -3.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(36, 0).addBox(0.0F, -1.5F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(28, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(50, 0).addBox(0.0F, -1.0F, -1.0F, 0.0F, 1.0F, 3.0F), PartPose.offset(0.0F, 20.0F, 0.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(0, 11).addBox(-1.5F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(-1.0F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(56, 0).addBox(0.0F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(1.0F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
    }

    /** redfish —— 9 个零件，图集 64×16 */
    private static void build_redfish(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.0F, -2.0F, 0.0F, 2.0F, 4.0F, 7.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(18, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("nose", CubeListBuilder.create().texOffs(50, 0).addBox(-1.0F, -2.0F, -1.0F, 2.0F, 3.0F, 1.0F), PartPose.offset(0.0F, 22.0F, -3.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(36, 0).addBox(0.0F, -1.5F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(28, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(56, 0).addBox(0.0F, -1.0F, -1.0F, 0.0F, 1.0F, 3.0F), PartPose.offset(0.0F, 20.0F, 0.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(6, 11).addBox(-1.5F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(-1.0F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(0, 11).addBox(0.0F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(1.0F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
        root.addOrReplaceChild("dorsal_long", CubeListBuilder.create().texOffs(44, 0).addBox(0.0F, -2.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 20.0F, 3.0F));
    }

    /** sablefish —— 10 个零件，图集 64×16 */
    private static void build_sablefish(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.0F, -2.0F, 0.0F, 2.0F, 4.0F, 7.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(28, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("nose", CubeListBuilder.create().texOffs(0, 11).addBox(-1.0F, -2.0F, -1.0F, 2.0F, 3.0F, 1.0F), PartPose.offset(0.0F, 22.0F, -3.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(46, 0).addBox(0.0F, -1.5F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(38, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(6, 11).addBox(0.0F, -1.0F, -1.0F, 0.0F, 1.0F, 3.0F), PartPose.offset(0.0F, 20.0F, 0.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(18, 11).addBox(-1.5F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(-1.0F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(12, 11).addBox(0.0F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(1.0F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
        root.addOrReplaceChild("dorsal2", CubeListBuilder.create().texOffs(54, 0).addBox(0.0F, -2.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 20.0F, 9.0F));
        root.addOrReplaceChild("dorsal_long", CubeListBuilder.create().texOffs(18, 0).addBox(0.0F, -2.0F, 0.0F, 0.0F, 2.0F, 5.0F), PartPose.offset(0.0F, 20.0F, 3.0F));
    }

    /** atlantic_cod —— 9 个零件，图集 64×16 */
    private static void build_atlantic_cod(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.0F, -2.0F, 0.0F, 2.0F, 4.0F, 7.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(28, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("nose", CubeListBuilder.create().texOffs(54, 0).addBox(-1.0F, -2.0F, -1.0F, 2.0F, 3.0F, 1.0F), PartPose.offset(0.0F, 22.0F, -3.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(46, 0).addBox(0.0F, -1.5F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(38, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(0, 11).addBox(0.0F, -1.0F, -1.0F, 0.0F, 1.0F, 3.0F), PartPose.offset(0.0F, 20.0F, 0.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(12, 11).addBox(-1.5F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(-1.0F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(6, 11).addBox(0.0F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(1.0F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
        root.addOrReplaceChild("dorsal_long", CubeListBuilder.create().texOffs(18, 0).addBox(0.0F, -2.0F, 0.0F, 0.0F, 2.0F, 5.0F), PartPose.offset(0.0F, 20.0F, 3.0F));
    }

    /** greenland_halibut —— 9 个零件，图集 64×16 */
    private static void build_greenland_halibut(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.0F, -2.0F, 0.0F, 2.0F, 4.0F, 7.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(28, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("nose", CubeListBuilder.create().texOffs(54, 0).addBox(-1.0F, -2.0F, -1.0F, 2.0F, 3.0F, 1.0F), PartPose.offset(0.0F, 22.0F, -3.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(46, 0).addBox(0.0F, -1.5F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(38, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(0, 11).addBox(0.0F, -1.0F, -1.0F, 0.0F, 1.0F, 3.0F), PartPose.offset(0.0F, 20.0F, 0.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(12, 11).addBox(-1.5F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(-1.0F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(6, 11).addBox(0.0F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(1.0F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
        root.addOrReplaceChild("dorsal_long", CubeListBuilder.create().texOffs(18, 0).addBox(0.0F, -2.0F, 0.0F, 0.0F, 2.0F, 5.0F), PartPose.offset(0.0F, 20.0F, 3.0F));
    }

    /** greenland_shark —— 18 个零件，图集 64×32 */
    private static void build_greenland_shark(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("body2", CubeListBuilder.create().texOffs(22, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 8.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(54, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("tail_hetero_up", CubeListBuilder.create().texOffs(44, 0).addBox(0.0F, -3.0F, 0.0F, 0.0F, 3.0F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, 0.42F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_hetero_lo", CubeListBuilder.create().texOffs(0, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 3.0F, 4.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, -0.58F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(12, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 5.0F));
        root.addOrReplaceChild("top_fin2", CubeListBuilder.create().texOffs(18, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 7.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(29, 20).addBox(-1.6F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(-1.5F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(22, 20).addBox(0.0F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(1.5F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
        root.addOrReplaceChild("gill_1", CubeListBuilder.create().texOffs(32, 13).addBox(-1.52F, -1.0F, -1.0F, 3.04F, 2.0F, 1.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("gill_2", CubeListBuilder.create().texOffs(41, 13).addBox(-1.52F, -1.0F, -2.0F, 3.04F, 2.0F, 1.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("gill_3", CubeListBuilder.create().texOffs(50, 13).addBox(-1.52F, -1.0F, -3.0F, 3.04F, 2.0F, 1.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("gill_4", CubeListBuilder.create().texOffs(0, 20).addBox(-1.52F, -1.0F, -4.0F, 3.04F, 2.0F, 1.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("gill_5", CubeListBuilder.create().texOffs(9, 20).addBox(-1.52F, -1.0F, -5.0F, 3.04F, 2.0F, 1.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("dorsal_a", CubeListBuilder.create().texOffs(18, 20).addBox(0.0F, -1.0F, 0.0F, 0.0F, 1.0F, 2.0F), PartPose.offset(0.0F, 19.0F, 2.0F));
        root.addOrReplaceChild("dorsal_b", CubeListBuilder.create().texOffs(28, 13).addBox(0.0F, -2.0F, 0.0F, 0.0F, 2.0F, 2.0F), PartPose.offset(0.0F, 19.0F, 4.0F));
        root.addOrReplaceChild("dorsal_c", CubeListBuilder.create().texOffs(24, 13).addBox(0.0F, -3.0F, 0.0F, 0.0F, 3.0F, 2.0F), PartPose.offset(0.0F, 19.0F, 6.0F));
        root.addOrReplaceChild("dorsal_d", CubeListBuilder.create().texOffs(8, 13).addBox(0.0F, -4.0F, 0.0F, 0.0F, 4.0F, 2.0F), PartPose.offset(0.0F, 19.0F, 8.0F));
    }

    /** sailfish —— 10 个零件，图集 64×32 */
    private static void build_sailfish(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("body2", CubeListBuilder.create().texOffs(22, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 8.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(0, 13).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(20, 13).addBox(0.0F, -1.8F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(10, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(30, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 5.0F));
        root.addOrReplaceChild("top_fin2", CubeListBuilder.create().texOffs(36, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 7.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(49, 13).addBox(-1.6F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(-1.5F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(42, 13).addBox(0.0F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(1.5F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
        root.addOrReplaceChild("dorsal_long", CubeListBuilder.create().texOffs(44, 0).addBox(0.0F, -2.0F, 0.0F, 0.0F, 2.0F, 6.0F), PartPose.offset(0.0F, 19.0F, 3.0F));
    }

    /** mahi_mahi —— 10 个零件，图集 64×32 */
    private static void build_mahi_mahi(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("body2", CubeListBuilder.create().texOffs(22, 0).addBox(-1.5F, -2.5F, 0.0F, 3.0F, 5.0F, 8.0F), PartPose.offset(0.0F, 21.5F, 8.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(0, 13).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 21.5F, 0.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(20, 13).addBox(0.0F, -1.8F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(10, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.8F, 5.0F), PartPose.offsetAndRotation(0.0F, 21.5F, 16.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(30, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 5.0F));
        root.addOrReplaceChild("top_fin2", CubeListBuilder.create().texOffs(36, 13).addBox(0.0F, 0.0F, 0.0F, 0.0F, 2.0F, 3.0F), PartPose.offset(0.0F, 17.0F, 7.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(49, 13).addBox(-1.6F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(-1.5F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(42, 13).addBox(0.0F, 0.0F, 0.0F, 1.6F, 0.0F, 1.6F), PartPose.offsetAndRotation(1.5F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
        root.addOrReplaceChild("dorsal_long", CubeListBuilder.create().texOffs(44, 0).addBox(0.0F, -2.0F, 0.0F, 0.0F, 2.0F, 6.0F), PartPose.offset(0.0F, 19.0F, 3.0F));
    }

    /** alligator_gar —— 9 个零件，图集 64×16 */
    private static void build_alligator_gar(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.0F, -2.0F, 0.0F, 2.0F, 4.0F, 7.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(18, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("nose", CubeListBuilder.create().texOffs(52, 0).addBox(-1.0F, -2.0F, -1.0F, 2.0F, 3.0F, 1.0F), PartPose.offset(0.0F, 22.0F, -3.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(44, 0).addBox(0.0F, -1.5F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(36, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(58, 0).addBox(0.0F, -1.0F, -1.0F, 0.0F, 1.0F, 3.0F), PartPose.offset(0.0F, 20.0F, 0.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(6, 11).addBox(-1.5F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(-1.0F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(0, 11).addBox(0.0F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(1.0F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
        root.addOrReplaceChild("dorsal_long", CubeListBuilder.create().texOffs(28, 0).addBox(0.0F, -2.0F, 0.0F, 0.0F, 2.0F, 4.0F), PartPose.offset(0.0F, 20.0F, 3.0F));
    }

    /** giant_siamese_carp —— 9 个零件，图集 64×16 */
    private static void build_giant_siamese_carp(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.0F, -2.0F, 0.0F, 2.0F, 4.0F, 7.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(28, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("nose", CubeListBuilder.create().texOffs(54, 0).addBox(-1.0F, -2.0F, -1.0F, 2.0F, 3.0F, 1.0F), PartPose.offset(0.0F, 22.0F, -3.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(46, 0).addBox(0.0F, -1.5F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(38, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(0, 11).addBox(0.0F, -1.0F, -1.0F, 0.0F, 1.0F, 3.0F), PartPose.offset(0.0F, 20.0F, 0.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(12, 11).addBox(-1.5F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(-1.0F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(6, 11).addBox(0.0F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(1.0F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
        root.addOrReplaceChild("dorsal_long", CubeListBuilder.create().texOffs(18, 0).addBox(0.0F, -2.0F, 0.0F, 0.0F, 2.0F, 5.0F), PartPose.offset(0.0F, 20.0F, 3.0F));
    }

    /** electric_eel —— 8 个零件，图集 64×16 */
    private static void build_electric_eel(PartDefinition root) {
        root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 0).addBox(-1.0F, -2.0F, 0.0F, 2.0F, 4.0F, 7.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(18, 0).addBox(-1.0F, -2.0F, -3.0F, 2.0F, 4.0F, 3.0F), PartPose.offset(0.0F, 22.0F, 0.0F));
        root.addOrReplaceChild("nose", CubeListBuilder.create().texOffs(44, 0).addBox(-1.0F, -2.0F, -1.0F, 2.0F, 3.0F, 1.0F), PartPose.offset(0.0F, 22.0F, -3.0F));
        root.addOrReplaceChild("tail_crescent_up", CubeListBuilder.create().texOffs(36, 0).addBox(0.0F, -1.5F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, 0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("tail_crescent_lo", CubeListBuilder.create().texOffs(28, 0).addBox(0.0F, 0.0F, 0.0F, 0.0F, 1.5F, 4.0F), PartPose.offsetAndRotation(0.0F, 22.0F, 7.0F, -0.55F, 0.0F, 0.0F));
        root.addOrReplaceChild("top_fin", CubeListBuilder.create().texOffs(50, 0).addBox(0.0F, -1.0F, -1.0F, 0.0F, 1.0F, 3.0F), PartPose.offset(0.0F, 20.0F, 0.0F));
        root.addOrReplaceChild("pectoral_r", CubeListBuilder.create().texOffs(0, 11).addBox(-1.5F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(-1.0F, 23.0F, 0.0F, 0.0F, 0.0F, -(float) Math.PI / 4.0F));
        root.addOrReplaceChild("pectoral_l", CubeListBuilder.create().texOffs(56, 0).addBox(0.0F, 0.0F, -1.0F, 1.5F, 0.0F, 1.5F), PartPose.offsetAndRotation(1.0F, 23.0F, 0.0F, 0.0F, 0.0F, (float) Math.PI / 4.0F));
    }

    private static final Map<String, String[]> TAILS = Map.ofEntries(
            Map.entry("tilapia", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("african_butterflyfish", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("crucian_carp", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("mirror_carp", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("jewel_cichlid", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("mullet", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("zander", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("atlantic_salmon", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("bluefin_tuna", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("brown_trout", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("tigerfish", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("topmouth_culter", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("hemiculter", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("striped_bass", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("platinum_arowana", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("oxeye_tarpon", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("banded_loach", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("guppy", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("elephantnose", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("golden_loach", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("cave_blindfish", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("grass_carp", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("black_carp", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("pike", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("arapaima", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("north_african_catfish", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("sapphire_snakehead", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("juvenile_shark", new String[]{"tail_hetero_up", "tail_hetero_lo"}),
            Map.entry("arctic_char", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("whitefish", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("rainbow_trout", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("burbot", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("taimen", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("arctic_cod", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("capelin", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("atlantic_herring", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("wolffish", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("redfish", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("sablefish", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("atlantic_cod", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("greenland_halibut", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("greenland_shark", new String[]{"tail_hetero_up", "tail_hetero_lo"}),
            Map.entry("sailfish", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("mahi_mahi", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("alligator_gar", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("giant_siamese_carp", new String[]{"tail_crescent_up", "tail_crescent_lo"}),
            Map.entry("electric_eel", new String[]{"tail_crescent_up", "tail_crescent_lo"})
    );

    private static final Map<String, Integer> ATLAS_W = Map.ofEntries(
            Map.entry("tilapia", 64),
            Map.entry("african_butterflyfish", 64),
            Map.entry("crucian_carp", 64),
            Map.entry("mirror_carp", 64),
            Map.entry("jewel_cichlid", 64),
            Map.entry("mullet", 64),
            Map.entry("zander", 64),
            Map.entry("atlantic_salmon", 64),
            Map.entry("bluefin_tuna", 64),
            Map.entry("brown_trout", 64),
            Map.entry("tigerfish", 64),
            Map.entry("topmouth_culter", 64),
            Map.entry("hemiculter", 64),
            Map.entry("striped_bass", 64),
            Map.entry("platinum_arowana", 64),
            Map.entry("oxeye_tarpon", 64),
            Map.entry("banded_loach", 64),
            Map.entry("guppy", 64),
            Map.entry("elephantnose", 64),
            Map.entry("golden_loach", 64),
            Map.entry("cave_blindfish", 64),
            Map.entry("grass_carp", 64),
            Map.entry("black_carp", 64),
            Map.entry("pike", 64),
            Map.entry("arapaima", 64),
            Map.entry("north_african_catfish", 64),
            Map.entry("sapphire_snakehead", 64),
            Map.entry("juvenile_shark", 64),
            Map.entry("arctic_char", 64),
            Map.entry("whitefish", 64),
            Map.entry("rainbow_trout", 64),
            Map.entry("burbot", 64),
            Map.entry("taimen", 64),
            Map.entry("arctic_cod", 64),
            Map.entry("capelin", 64),
            Map.entry("atlantic_herring", 64),
            Map.entry("wolffish", 64),
            Map.entry("redfish", 64),
            Map.entry("sablefish", 64),
            Map.entry("atlantic_cod", 64),
            Map.entry("greenland_halibut", 64),
            Map.entry("greenland_shark", 64),
            Map.entry("sailfish", 64),
            Map.entry("mahi_mahi", 64),
            Map.entry("alligator_gar", 64),
            Map.entry("giant_siamese_carp", 64),
            Map.entry("electric_eel", 64)
    );

    private static final Map<String, Integer> ATLAS_H = Map.ofEntries(
            Map.entry("tilapia", 16),
            Map.entry("african_butterflyfish", 16),
            Map.entry("crucian_carp", 16),
            Map.entry("mirror_carp", 32),
            Map.entry("jewel_cichlid", 16),
            Map.entry("mullet", 32),
            Map.entry("zander", 32),
            Map.entry("atlantic_salmon", 32),
            Map.entry("bluefin_tuna", 32),
            Map.entry("brown_trout", 32),
            Map.entry("tigerfish", 32),
            Map.entry("topmouth_culter", 32),
            Map.entry("hemiculter", 16),
            Map.entry("striped_bass", 32),
            Map.entry("platinum_arowana", 32),
            Map.entry("oxeye_tarpon", 32),
            Map.entry("banded_loach", 16),
            Map.entry("guppy", 16),
            Map.entry("elephantnose", 16),
            Map.entry("golden_loach", 16),
            Map.entry("cave_blindfish", 16),
            Map.entry("grass_carp", 32),
            Map.entry("black_carp", 32),
            Map.entry("pike", 32),
            Map.entry("arapaima", 32),
            Map.entry("north_african_catfish", 32),
            Map.entry("sapphire_snakehead", 16),
            Map.entry("juvenile_shark", 32),
            Map.entry("arctic_char", 32),
            Map.entry("whitefish", 32),
            Map.entry("rainbow_trout", 32),
            Map.entry("burbot", 16),
            Map.entry("taimen", 32),
            Map.entry("arctic_cod", 16),
            Map.entry("capelin", 32),
            Map.entry("atlantic_herring", 32),
            Map.entry("wolffish", 16),
            Map.entry("redfish", 16),
            Map.entry("sablefish", 16),
            Map.entry("atlantic_cod", 16),
            Map.entry("greenland_halibut", 16),
            Map.entry("greenland_shark", 32),
            Map.entry("sailfish", 32),
            Map.entry("mahi_mahi", 32),
            Map.entry("alligator_gar", 16),
            Map.entry("giant_siamese_carp", 16),
            Map.entry("electric_eel", 16)
    );

    @Override
    public void setupAnim(FishRenderState state) {
        // 摆尾：照抄 CodModel，出水时摆得更快。
        // 四种尾型（叉/圆/新月/歪尾）共用这一句，只是各自只有属于自己的零件存在。
        float f = state.isInWater ? 1.0F : 1.5F;
        float swing = -f * 0.45F * Mth.sin(0.6F * state.ageInTicks);
        for (ModelPart tail : this.tails) {
            tail.yRot = swing;
        }
    }
}
