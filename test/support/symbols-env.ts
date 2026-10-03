// 必须作为测试文件的第一条 import：ESM 按源顺序求值，
// 此副作用模块会先于 src 模块执行，从而在 LIMITS 冻结前注入小预算。
process.env.LSYSTEM_MAX_SYMBOLS = '100';
