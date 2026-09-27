export declare class AddNodeRedUserDto {
    username: string;
    password: string;
    permission?: '*' | 'read';
}
export declare class UpdateNodeRedUserDto {
    password?: string;
    permission?: '*' | 'read';
}
