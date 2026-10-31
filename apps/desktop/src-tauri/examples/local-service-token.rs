// 发布验收与正式账号启动复用同一个生成器；此工具不随客户端安装。
#[path = "../src/account/token.rs"]
mod token;

fn main() {
    println!("{}", token::random_token());
}
