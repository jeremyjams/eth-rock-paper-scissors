pragma solidity >=0.6.0 <0.8.0;

//import "@openzeppelin/contracts/access/Ownable.sol"
import "./openzeppelin/Ownable.sol";

contract Pausable is Ownable {

    event Paused(address account);
    event Unpaused(address account);
    event Killed(address account);
    event Purged(address account);

    bool private paused;
    bool private killed;

    constructor (bool _paused) internal {
        paused = _paused;
    }

    function isPaused() public view returns (bool) {
        return paused;
    }

    function isKilled() public view returns (bool) {
        return killed;
    }

    modifier whenNotPaused() {
        require(!paused, "Pausable: paused");
        _;
    }

    modifier whenPaused() {
        require(paused, "Pausable: not paused");
        _;
    }

    modifier whenNotKilled  {
        require(!killed, "Pausable: Should not be killed");
        _;
    }

    modifier whenKilled  {
        require(killed, "Pausable: Should be killed");
        _;
    }

    function pause() public onlyOwner whenNotPaused {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() public onlyOwner whenNotKilled whenPaused {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function kill() public onlyOwner whenNotKilled whenPaused {
        killed = true;
        emit Killed(msg.sender);
    }

    function purge(address beneficiary) public onlyOwner whenKilled returns (bool success) {
        require(beneficiary != address(0), "Beneficiary should be set");
        require(address(this).balance > 0, "Nothing to purge on this contract");
        emit Purged(msg.sender);
        (success,) = beneficiary.call.value(address(this).balance)("");
        require(success, "Purge transfer failed");
    }

}
